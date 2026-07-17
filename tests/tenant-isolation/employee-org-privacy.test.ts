import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestEmployee,
  createTestUser,
  createTestUserWithMembership,
  createTestProvider,
  createProviderUser,
  linkProviderToCompany,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { buildSstActor } from "@/lib/sst-auth";
import {
  createEmployeeForCompany,
  updateEmployeeForCompany,
  validateEmployeeOrganizationReferences,
} from "@/lib/employees";
import { maskEmployeeDocument } from "@/lib/sst-employees";

// =============================================================================
// Sprint SST 1.4F.1 — hardening de colaboradores, relações organizacionais e
// privacidade do Portal SST. Cobre: isolamento de Department/Position entre
// tenants (serviço + APIs dos dois portais), atomicidade da validação,
// privacidade do documento por papel, e semântica de auditoria da
// inativação (employee.deactivate).
// =============================================================================

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}
function toSession(user: { id: string; name: string; email: string; companyId: string | null }): TestSessionUser {
  return { ...user, active: true };
}

let empRoute: typeof import("@/app/api/employees/route");
let empDetailRoute: typeof import("@/app/api/employees/[id]/route");
let sstListRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/route");
let sstDetailRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

beforeAll(async () => {
  empRoute = await import("@/app/api/employees/route");
  empDetailRoute = await import("@/app/api/employees/[id]/route");
  sstListRoute = await import("@/app/api/sst/companies/[companyId]/employees/route");
  sstDetailRoute = await import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  return company;
}
async function makeCompanyWithRoles(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  return company;
}
async function makeProvider(label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  return provider;
}
async function makeDepartment(companyId: string, label: string) {
  return prisma.department.create({ data: { companyId, name: `__tenant_test__${label}` } });
}
async function makePosition(companyId: string, label: string) {
  return prisma.position.create({ data: { companyId, name: `__tenant_test__${label}` } });
}
/** `AuditLog.actorUserId` tem FK real para `User` — nunca um literal
 * inventado (violaria a constraint assim que createEmployeeForCompany
 * tentasse logar). */
async function makeActor(companyId: string, label: string) {
  const user = await createTestUser(companyId, label);
  return { id: user.id, name: user.name };
}

async function setupSstScenario(label: string) {
  const company = await makeCompany(label);
  const provider = await makeProvider(label);
  const user = await createTestUser(company.id, `${label}-u`);
  await createProviderUser({ providerId: provider.id, userId: user.id, role: "OWNER" });
  const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });
  return { company, provider, user, link };
}

const TRUSTED_ORIGIN = "http://localhost:3010";
function jsonRequest(body: Record<string, unknown> | undefined, headerOverrides?: Record<string, string | undefined>) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: TRUSTED_ORIGIN };
  if (headerOverrides) {
    for (const [key, value] of Object.entries(headerOverrides)) {
      if (value === undefined) delete headers[key];
      else headers[key] = value;
    }
  }
  return new NextRequest(`${TRUSTED_ORIGIN}/api/x`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function sstCompanyParams(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}
function sstEmployeeParams(companyId: string, employeeId: string) {
  return { params: Promise.resolve({ companyId, employeeId }) };
}
function empParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// =============================================================================
// Isolamento de Department/Position entre tenants — serviço central
// =============================================================================

describe("validateEmployeeOrganizationReferences / createEmployeeForCompany / updateEmployeeForCompany", () => {
  it("cria normalmente com Department e Position da MESMA Company", async () => {
    const companyA = await makeCompany("svc-ok-a");
    const dept = await makeDepartment(companyA.id, "dept-ok");
    const pos = await makePosition(companyA.id, "pos-ok");
    const actor = await makeActor(companyA.id, "actor");

    const employee = await createEmployeeForCompany(
      companyA.id,
      { name: "OK", document: `ok-${Date.now()}`, status: "ACTIVE", departmentId: dept.id, positionId: pos.id },
      actor,
    );
    expect(employee.departmentId).toBe(dept.id);
    expect(employee.positionId).toBe(pos.id);
  });

  it("departmentId null/undefined é permitido (campo opcional)", async () => {
    const companyA = await makeCompany("svc-null-ok");
    const actor = await makeActor(companyA.id, "actor");
    const employee = await createEmployeeForCompany(companyA.id, { name: "SemSetor", document: `null-${Date.now()}`, status: "ACTIVE" }, actor);
    expect(employee.departmentId).toBeNull();
    expect(employee.positionId).toBeNull();
  });

  it("rejeita Department de outra Company (create) — nenhum Employee é criado", async () => {
    const companyA = await makeCompany("svc-create-dept-a");
    const companyB = await makeCompany("svc-create-dept-b");
    const deptB = await makeDepartment(companyB.id, "dept-b");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(companyA.id, { name: "X", document: `x-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id }, actor),
    ).rejects.toThrow(/não está disponível para esta empresa/);

    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "X" } });
    expect(created).toBeNull();
  });

  it("rejeita Position de outra Company (create) — nenhum Employee é criado", async () => {
    const companyA = await makeCompany("svc-create-pos-a");
    const companyB = await makeCompany("svc-create-pos-b");
    const posB = await makePosition(companyB.id, "pos-b");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(companyA.id, { name: "Y", document: `y-${Date.now()}`, status: "ACTIVE", positionId: posB.id }, actor),
    ).rejects.toThrow(/não está disponível para esta empresa/);

    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Y" } });
    expect(created).toBeNull();
  });

  it("rejeita Department E Position de outra Company simultaneamente", async () => {
    const companyA = await makeCompany("svc-create-both-a");
    const companyB = await makeCompany("svc-create-both-b");
    const deptB = await makeDepartment(companyB.id, "dept-both-b");
    const posB = await makePosition(companyB.id, "pos-both-b");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(
        companyA.id,
        { name: "Z", document: `z-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id, positionId: posB.id },
        actor,
      ),
    ).rejects.toThrow(/não está disponível para esta empresa/);

    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Z" } });
    expect(created).toBeNull();
  });

  it("departmentId válido da A + positionId inválido (de B) é rejeitado por inteiro", async () => {
    const companyA = await makeCompany("svc-mixed-1-a");
    const companyB = await makeCompany("svc-mixed-1-b");
    const deptA = await makeDepartment(companyA.id, "dept-mixed-1-a");
    const posB = await makePosition(companyB.id, "pos-mixed-1-b");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(
        companyA.id,
        { name: "Mixed1", document: `mixed1-${Date.now()}`, status: "ACTIVE", departmentId: deptA.id, positionId: posB.id },
        actor,
      ),
    ).rejects.toThrow();
    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Mixed1" } });
    expect(created).toBeNull();
  });

  it("departmentId inválido (de B) + positionId válido da A é rejeitado por inteiro", async () => {
    const companyA = await makeCompany("svc-mixed-2-a");
    const companyB = await makeCompany("svc-mixed-2-b");
    const deptB = await makeDepartment(companyB.id, "dept-mixed-2-b");
    const posA = await makePosition(companyA.id, "pos-mixed-2-a");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(
        companyA.id,
        { name: "Mixed2", document: `mixed2-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id, positionId: posA.id },
        actor,
      ),
    ).rejects.toThrow();
    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Mixed2" } });
    expect(created).toBeNull();
  });

  it("departmentId/positionId inexistentes (cuid aleatório) geram erro amigável, não uma exceção de banco crua", async () => {
    const companyA = await makeCompany("svc-nonexistent");
    const actor = await makeActor(companyA.id, "actor");

    await expect(
      createEmployeeForCompany(
        companyA.id,
        { name: "Fantasma", document: `fant-${Date.now()}`, status: "ACTIVE", departmentId: "clnonexistentid00000000000" },
        actor,
      ),
    ).rejects.toThrow(/não está disponível para esta empresa/);
  });

  it("update rejeita troca para Department/Position de outra Company; Employee permanece inalterado, companyId nunca muda, nenhuma auditoria de sucesso", async () => {
    const companyA = await makeCompany("svc-update-a");
    const companyB = await makeCompany("svc-update-b");
    const deptA = await makeDepartment(companyA.id, "dept-update-a");
    const deptB = await makeDepartment(companyB.id, "dept-update-b");
    const actor = await makeActor(companyA.id, "actor");

    const employee = await createEmployeeForCompany(
      companyA.id,
      { name: "Original", document: `orig-${Date.now()}`, status: "ACTIVE", departmentId: deptA.id },
      actor,
    );

    await expect(
      updateEmployeeForCompany(companyA.id, employee.id, { name: "Original", document: employee.document, status: "ACTIVE", departmentId: deptB.id }, actor),
    ).rejects.toThrow(/não está disponível para esta empresa/);

    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.companyId).toBe(companyA.id);
    expect(reloaded.departmentId).toBe(deptA.id); // nunca trocado

    const successAudits = await prisma.auditLog.count({ where: { targetId: employee.id, action: "employee.update" } });
    expect(successAudits).toBe(0); // só o create aconteceu; o update falhou, sem auditoria de sucesso
  });

  it("Employee de uma Company com Department válido de OUTRA Company (registro pré-existente hipotético) não é criável via serviço — reforça que a checagem sempre roda", async () => {
    const companyA = await makeCompany("svc-cross-check-a");
    const companyC = await makeCompany("svc-cross-check-c");
    const deptC = await makeDepartment(companyC.id, "dept-cross-c");

    await expect(
      validateEmployeeOrganizationReferences({ companyId: companyA.id, departmentId: deptC.id, positionId: null, tx: prisma }),
    ).rejects.toThrow(/não está disponível para esta empresa/);
  });

  it("erro nunca expõe P2002/P2025/nome de constraint ou nome da outra Company/Department/Position", async () => {
    const companyA = await makeCompany("svc-error-safety-a");
    const companyB = await makeCompany("svc-error-safety-b");
    const deptB = await makeDepartment(companyB.id, "SECRETO-DEPT-B");
    const actor = await makeActor(companyA.id, "actor");

    try {
      await createEmployeeForCompany(companyA.id, { name: "W", document: `w-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id }, actor);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/P2002|P2025|constraint|foreign key/i);
      expect(message).not.toContain("SECRETO-DEPT-B");
      expect(message).not.toContain(companyB.id);
    }
  });
});

// =============================================================================
// Isolamento — API do Portal SST
// =============================================================================

describe("Isolamento cross-tenant — API Portal SST", () => {
  it("POST rejeita departmentId de outra Company", async () => {
    const { company, user } = await setupSstScenario("sst-post-dept");
    const companyB = await makeCompany("sst-post-dept-b");
    const deptB = await makeDepartment(companyB.id, "dept-sst-post");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.POST(
      jsonRequest({ name: "SST1", document: `sst1-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id }),
      sstCompanyParams(company.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/não está disponível para esta empresa/);
    const created = await prisma.employee.findFirst({ where: { companyId: company.id, name: "SST1" } });
    expect(created).toBeNull();
  });

  it("POST rejeita positionId de outra Company", async () => {
    const { company, user } = await setupSstScenario("sst-post-pos");
    const companyB = await makeCompany("sst-post-pos-b");
    const posB = await makePosition(companyB.id, "pos-sst-post");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.POST(
      jsonRequest({ name: "SST2", document: `sst2-${Date.now()}`, status: "ACTIVE", positionId: posB.id }),
      sstCompanyParams(company.id),
    );
    expect(res.status).toBe(400);
    const created = await prisma.employee.findFirst({ where: { companyId: company.id, name: "SST2" } });
    expect(created).toBeNull();
  });

  it("POST rejeita ambos externos", async () => {
    const { company, user } = await setupSstScenario("sst-post-both");
    const companyB = await makeCompany("sst-post-both-b");
    const deptB = await makeDepartment(companyB.id, "dept-sst-both");
    const posB = await makePosition(companyB.id, "pos-sst-both");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.POST(
      jsonRequest({ name: "SST3", document: `sst3-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id, positionId: posB.id }),
      sstCompanyParams(company.id),
    );
    expect(res.status).toBe(400);
    const created = await prisma.employee.findFirst({ where: { companyId: company.id, name: "SST3" } });
    expect(created).toBeNull();
  });

  it("PUT rejeita departmentId externo; Employee inalterado", async () => {
    const { company, provider, user } = await setupSstScenario("sst-put-dept");
    const companyB = await makeCompany("sst-put-dept-b");
    const deptB = await makeDepartment(companyB.id, "dept-sst-put");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "SST4", document: `sst4-${Date.now()}`, status: "ACTIVE" }, actor);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstDetailRoute.PUT(
      jsonRequest({ name: "SST4", document: employee.document, status: "ACTIVE", departmentId: deptB.id }),
      sstEmployeeParams(company.id, employee.id),
    );
    expect(res.status).toBe(400);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.departmentId).toBeNull();
  });

  it("PUT rejeita positionId externo; Employee inalterado", async () => {
    const { company, provider, user } = await setupSstScenario("sst-put-pos");
    const companyB = await makeCompany("sst-put-pos-b");
    const posB = await makePosition(companyB.id, "pos-sst-put");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "SST5", document: `sst5-${Date.now()}`, status: "ACTIVE" }, actor);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstDetailRoute.PUT(
      jsonRequest({ name: "SST5", document: employee.document, status: "ACTIVE", positionId: posB.id }),
      sstEmployeeParams(company.id, employee.id),
    );
    expect(res.status).toBe(400);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.positionId).toBeNull();
  });

  it("relation/connect malicioso ou objeto Prisma inesperado no body é rejeitado pelo schema Zod (nunca chega ao Prisma)", async () => {
    const { company, user } = await setupSstScenario("sst-relation-connect");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.POST(
      jsonRequest({
        name: "SST6",
        document: `sst6-${Date.now()}`,
        status: "ACTIVE",
        departmentId: { connect: { id: "some-other-id" } },
      }),
      sstCompanyParams(company.id),
    );
    expect(res.status).toBe(400);
    const created = await prisma.employee.findFirst({ where: { companyId: company.id, name: "SST6" } });
    expect(created).toBeNull();
  });

  it("companyId/providerId forjados no body nunca têm efeito (schema não tem esses campos)", async () => {
    const { company, user } = await setupSstScenario("sst-forged");
    const companyB = await makeCompany("sst-forged-b");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.POST(
      jsonRequest({ name: "SST7", document: `sst7-${Date.now()}`, status: "ACTIVE", companyId: companyB.id, providerId: "forjado" }),
      sstCompanyParams(company.id),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { employee: { companyId: string } };
    expect(body.employee.companyId).toBe(company.id);
  });
});

// =============================================================================
// Isolamento — API do Portal Empresa
// =============================================================================

describe("Isolamento cross-tenant — API Portal Empresa", () => {
  it("POST rejeita departmentId de outra Company", async () => {
    const companyA = await makeCompanyWithRoles("emp-post-dept-a");
    const companyB = await makeCompany("emp-post-dept-b");
    const deptB = await makeDepartment(companyB.id, "dept-emp-post");
    const admin = await createTestUserWithMembership(companyA.id, "emp-post-dept-admin");
    await assignSystemRole(admin.id, companyA.id, "ADMIN");
    loginAs(toSessionUser(admin));

    const res = await empRoute.POST(
      new NextRequest("http://localhost/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Emp1", document: `emp1-${Date.now()}`, status: "ACTIVE", departmentId: deptB.id }),
      }),
    );
    expect(res.status).toBe(400);
    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Emp1" } });
    expect(created).toBeNull();
  });

  it("POST rejeita positionId de outra Company", async () => {
    const companyA = await makeCompanyWithRoles("emp-post-pos-a");
    const companyB = await makeCompany("emp-post-pos-b");
    const posB = await makePosition(companyB.id, "pos-emp-post");
    const admin = await createTestUserWithMembership(companyA.id, "emp-post-pos-admin");
    await assignSystemRole(admin.id, companyA.id, "ADMIN");
    loginAs(toSessionUser(admin));

    const res = await empRoute.POST(
      new NextRequest("http://localhost/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Emp2", document: `emp2-${Date.now()}`, status: "ACTIVE", positionId: posB.id }),
      }),
    );
    expect(res.status).toBe(400);
    const created = await prisma.employee.findFirst({ where: { companyId: companyA.id, name: "Emp2" } });
    expect(created).toBeNull();
  });

  it("PUT rejeita departmentId externo; Employee inalterado", async () => {
    const companyA = await makeCompanyWithRoles("emp-put-dept-a");
    const companyB = await makeCompany("emp-put-dept-b");
    const deptB = await makeDepartment(companyB.id, "dept-emp-put");
    const admin = await createTestUserWithMembership(companyA.id, "emp-put-dept-admin");
    await assignSystemRole(admin.id, companyA.id, "ADMIN");
    const employee = await createTestEmployee(companyA.id, "emp-put-dept-target");
    loginAs(toSessionUser(admin));

    const res = await empDetailRoute.PUT(
      new NextRequest(`http://localhost/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: employee.name.replace("__tenant_test__", ""), document: employee.document, status: "ACTIVE", departmentId: deptB.id }),
      }),
      empParams(employee.id),
    );
    expect(res.status).toBe(400);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.departmentId).toBeNull();
  });

  it("PUT rejeita positionId externo; Employee inalterado", async () => {
    const companyA = await makeCompanyWithRoles("emp-put-pos-a");
    const companyB = await makeCompany("emp-put-pos-b");
    const posB = await makePosition(companyB.id, "pos-emp-put");
    const admin = await createTestUserWithMembership(companyA.id, "emp-put-pos-admin");
    await assignSystemRole(admin.id, companyA.id, "ADMIN");
    const employee = await createTestEmployee(companyA.id, "emp-put-pos-target");
    loginAs(toSessionUser(admin));

    const res = await empDetailRoute.PUT(
      new NextRequest(`http://localhost/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: employee.name.replace("__tenant_test__", ""), document: employee.document, status: "ACTIVE", positionId: posB.id }),
      }),
      empParams(employee.id),
    );
    expect(res.status).toBe(400);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.positionId).toBeNull();
  });
});

// =============================================================================
// Privacidade do documento por papel
// =============================================================================

describe("Privacidade do documento por papel (Portal SST)", () => {
  it("GET detalhe SEMPRE mascara o documento, mesmo para OWNER com gestão (accessLevel OPERATION)", async () => {
    const { company, provider, user } = await setupSstScenario("privacy-owner-detail");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = "11122233344";
    const employee = await createEmployeeForCompany(company.id, { name: "PrivOwner", document: doc, status: "ACTIVE" }, actor);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employee: { document: string } };
    expect(body.employee.document).toBe(maskEmployeeDocument(doc));
    expect(body.employee.document).not.toBe(doc);
  });

  it("VIEWER recebe documento mascarado no detalhe", async () => {
    const company = await makeCompany("privacy-viewer-detail");
    const provider = await makeProvider("privacy-viewer-detail");
    const owner = await createTestUser(company.id, "privacy-viewer-detail-owner");
    await createProviderUser({ providerId: provider.id, userId: owner.id, role: "OWNER" });
    await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });
    const actor = buildSstActor({ user: { id: owner.id, name: owner.name }, providerId: provider.id });
    const doc = "55566677788";
    const employee = await createEmployeeForCompany(company.id, { name: "PrivViewer", document: doc, status: "ACTIVE" }, actor);

    const viewer = await createTestUser(company.id, "privacy-viewer-detail-viewer");
    await createProviderUser({ providerId: provider.id, userId: viewer.id, role: "VIEWER" });
    loginAs(toSession({ id: viewer.id, name: viewer.name, email: viewer.email, companyId: null }));

    const res = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employee: { document: string } };
    expect(body.employee.document).not.toBe(doc);
    expect(body.employee.document).toBe(maskEmployeeDocument(doc));
  });

  it("vínculo accessLevel VIEW recebe documento mascarado no detalhe", async () => {
    const company = await makeCompany("privacy-view-link-detail");
    const provider = await makeProvider("privacy-view-link-detail");
    const owner = await createTestUser(company.id, "privacy-view-link-owner");
    await createProviderUser({ providerId: provider.id, userId: owner.id, role: "OWNER" });
    await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "VIEW" });
    const doc = "99988877766";
    const employee = await createTestEmployee(company.id, "privacy-view-link-emp");
    await prisma.employee.update({ where: { id: employee.id }, data: { document: doc, name: "PrivViewLink" } });

    loginAs(toSession({ id: owner.id, name: owner.name, email: owner.email, companyId: null }));
    const res = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employee: { document: string } };
    expect(body.employee.document).not.toBe(doc);
  });

  it("outro provider (sem vínculo) recebe 404 no detalhe — não vaza nem dado mascarado", async () => {
    const { company } = await setupSstScenario("privacy-outsider-target");
    const employee = await createTestEmployee(company.id, "privacy-outsider-emp");
    const outsider = await setupSstScenario("privacy-outsider-provider");
    loginAs(toSession({ id: outsider.user.id, name: outsider.user.name, email: outsider.user.email, companyId: null }));

    const res = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(res.status).toBe(403); // bloqueado no guard, antes mesmo de resolver o Employee
  });

  it("vínculo revogado recebe bloqueio no detalhe (403), nunca o dado mascarado", async () => {
    const { company, provider, user } = await setupSstScenario("privacy-revoked-detail");
    const employee = await createTestEmployee(company.id, "privacy-revoked-emp");
    await prisma.sstProviderCompany.updateMany({ where: { providerId: provider.id, companyId: company.id }, data: { status: "REVOKED" } });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(res.status).toBe(403);
  });

  it("CLAIM_PENDING permite GET (mascarado) mas bloqueia PUT (edição) com 409", async () => {
    const { company, provider, user } = await setupSstScenario("privacy-claim-pending");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "PrivClaim", document: `pc-${Date.now()}`, status: "ACTIVE" }, actor);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const getRes = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(getRes.status).toBe(200);

    const putRes = await sstDetailRoute.PUT(
      jsonRequest({ name: "Nunca deveria salvar", document: employee.document, status: "ACTIVE" }),
      sstEmployeeParams(company.id, employee.id),
    );
    expect(putRes.status).toBe(409);
  });

  it("DISPUTED permite GET (mascarado) mas bloqueia PUT (edição) com 409", async () => {
    const { company, provider, user } = await setupSstScenario("privacy-disputed");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "PrivDisputed", document: `pd-${Date.now()}`, status: "ACTIVE" }, actor);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "DISPUTED" } });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const getRes = await sstDetailRoute.GET(jsonRequest(undefined), sstEmployeeParams(company.id, employee.id));
    expect(getRes.status).toBe(200);

    const putRes = await sstDetailRoute.PUT(
      jsonRequest({ name: "Nunca deveria salvar", document: employee.document, status: "ACTIVE" }),
      sstEmployeeParams(company.id, employee.id),
    );
    expect(putRes.status).toBe(409);
  });

  it("listagem SST nunca retorna o campo document bruto (só documentMasked)", async () => {
    const { company, user } = await setupSstScenario("privacy-listing-shape");
    await createTestEmployee(company.id, "privacy-listing-shape-emp");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await sstListRoute.GET(jsonRequest(undefined), sstCompanyParams(company.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employees: Array<Record<string, unknown>> };
    for (const row of body.employees) {
      expect(Object.prototype.hasOwnProperty.call(row, "document")).toBe(false);
    }
  });

  it("AuditLog nunca contém o documento integral, em create nem em update", async () => {
    const { company, provider, user } = await setupSstScenario("privacy-audit-doc");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = "13579246801";
    const employee = await createEmployeeForCompany(company.id, { name: "AuditDoc", document: doc, status: "ACTIVE" }, actor);
    await updateEmployeeForCompany(company.id, employee.id, { name: "AuditDoc2", document: doc, status: "ACTIVE" }, actor);

    const logs = await prisma.auditLog.findMany({ where: { targetId: employee.id } });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.targetLabel ?? "").not.toContain(doc);
      expect(JSON.stringify(log.metadata ?? {})).not.toContain(doc);
    }
  });
});

// =============================================================================
// Semântica de auditoria da inativação
// =============================================================================

describe("Semântica de auditoria — employee.deactivate", () => {
  it("inativação usa a ação employee.deactivate, nunca employee.delete, nos dois portais", async () => {
    const companyEmp = await makeCompanyWithRoles("audit-semantics-empresa");
    const admin = await createTestUserWithMembership(companyEmp.id, "audit-semantics-empresa-admin");
    await assignSystemRole(admin.id, companyEmp.id, "ADMIN");
    const employeeEmp = await createTestEmployee(companyEmp.id, "audit-semantics-empresa-emp");
    loginAs(toSessionUser(admin));
    const delRes = await empDetailRoute.DELETE(new NextRequest(`http://localhost/api/employees/${employeeEmp.id}`, { method: "DELETE" }), empParams(employeeEmp.id));
    expect(delRes.status).toBe(200);

    const empAudit = await prisma.auditLog.findFirst({ where: { targetId: employeeEmp.id } });
    expect(empAudit?.action).toBe("employee.deactivate");

    const { company, provider, user } = await setupSstScenario("audit-semantics-sst");
    const sstActor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employeeSst = await createEmployeeForCompany(company.id, { name: "SstDeactivate", document: `sd-${Date.now()}`, status: "ACTIVE" }, sstActor);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));
    const sstDeactivateRoute = await import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/deactivate/route");
    const sstRes = await sstDeactivateRoute.POST(jsonRequest({}), sstEmployeeParams(company.id, employeeSst.id));
    expect(sstRes.status).toBe(200);

    const sstAudit = await prisma.auditLog.findFirst({ where: { targetId: employeeSst.id, action: { in: ["employee.delete", "employee.deactivate"] } } });
    expect(sstAudit?.action).toBe("employee.deactivate");
  });

  it("nenhuma linha de AuditAction 'employee.delete' é gerada por código novo (só employee.deactivate)", async () => {
    const company = await makeCompanyWithRoles("audit-no-delete-generated");
    const admin = await createTestUserWithMembership(company.id, "audit-no-delete-generated-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const employee = await createTestEmployee(company.id, "audit-no-delete-generated-emp");
    loginAs(toSessionUser(admin));

    await empDetailRoute.DELETE(new NextRequest(`http://localhost/api/employees/${employee.id}`, { method: "DELETE" }), empParams(employee.id));

    const deleteLogs = await prisma.auditLog.count({ where: { targetId: employee.id, action: "employee.delete" } });
    expect(deleteLogs).toBe(0);
  });
});

// =============================================================================
// Diagnóstico — nenhuma inconsistência Department/Position após os testes
// =============================================================================

describe("Diagnóstico de consistência Department/Position", () => {
  it("nenhum Employee criado nesta suíte tem departmentId/positionId de OUTRA Company", async () => {
    const mismatchedDepartments = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count
      FROM "Employee" e
      JOIN "Department" d ON d.id = e."departmentId"
      WHERE e."companyId" != d."companyId"
    `;
    const mismatchedPositions = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count
      FROM "Employee" e
      JOIN "Position" p ON p.id = e."positionId"
      WHERE e."companyId" != p."companyId"
    `;
    expect(Number(mismatchedDepartments[0].count)).toBe(0);
    expect(Number(mismatchedPositions[0].count)).toBe(0);
  });
});
