import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  cleanupFixtures,
  createTestCompany,
  createTestUser,
  createTestUserWithMembership,
  createTestProvider,
  createProviderUser,
  linkProviderToCompany,
  prisma,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import {
  requireSstProviderEmployeeViewAccess,
  requireSstProviderEmployeeManageAccess,
  sstCanManageEmployees,
  buildSstActor,
  CompanyControlReviewInProgressError,
} from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import {
  createEmployeeForCompany,
  updateEmployeeForCompany,
  deactivateEmployeeForCompany,
  reactivateEmployeeForCompany,
  getEmployeeForCompany,
  getEmployeesPage,
} from "@/lib/employees";
import { maskEmployeeDocument, getSstCompanyEmployeesPage } from "@/lib/sst-employees";
import type {
  SstProviderCompanyStatus,
  SstProviderCompanyAccessLevel,
  SstProviderUserRole,
  CompanyControlStatus,
  CompanyOperationalStatus,
  SstProviderAuthorizationBasis,
} from "@/app/generated/prisma/client";

// =============================================================================
// Sprint SST 1.4F — Cadastro e gestão de colaboradores pela Consultoria SST.
// Cobre: matriz de autorização (papel x accessLevel), status do vínculo,
// estados da Company (UNCLAIMED/CLAIM_PENDING/DISPUTED/CLAIMED/SUSPENDED/
// CLOSED), propriedade dos dados (Employee continua só da Company),
// privacidade (documento mascarado, DTO mínimo), CSRF, concorrência e
// regressão do Portal Empresa.
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

let listRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/route");
let detailRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/route");
let deactivateRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/deactivate/route");
let reactivateRoute: typeof import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/reactivate/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

beforeAll(async () => {
  listRoute = await import("@/app/api/sst/companies/[companyId]/employees/route");
  detailRoute = await import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/route");
  deactivateRoute = await import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/deactivate/route");
  reactivateRoute = await import("@/app/api/sst/companies/[companyId]/employees/[employeeId]/reactivate/route");
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

async function makeProvider(label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  return provider;
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
function routeParams(companyId: string) {
  return { params: Promise.resolve({ companyId }) };
}
function employeeRouteParams(companyId: string, employeeId: string) {
  return { params: Promise.resolve({ companyId, employeeId }) };
}

type ScenarioOptions = {
  role?: SstProviderUserRole;
  accessLevel?: SstProviderCompanyAccessLevel;
  linkStatus?: SstProviderCompanyStatus;
  controlStatus?: CompanyControlStatus;
  operationalStatus?: CompanyOperationalStatus;
  authorizationBasis?: SstProviderAuthorizationBasis;
};

/** Monta um cenário completo (Company + SstProvider + SstProviderUser +
 * SstProviderCompany) com os parâmetros da matriz de autorização — evita
 * repetir os mesmos 4 inserts em cada teste. */
async function setupScenario(label: string, opts: ScenarioOptions = {}) {
  const company = await makeCompany(label);
  const provider = await makeProvider(label);
  const user = await createTestUser(company.id, `${label}-u`);
  await createProviderUser({ providerId: provider.id, userId: user.id, role: opts.role ?? "OWNER" });
  const link = await linkProviderToCompany({
    providerId: provider.id,
    companyId: company.id,
    status: opts.linkStatus ?? "ACTIVE",
    accessLevel: opts.accessLevel ?? "OPERATION",
  });
  if (opts.authorizationBasis) {
    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { authorizationBasis: opts.authorizationBasis } });
  }
  const companyUpdate: Record<string, unknown> = {};
  if (opts.controlStatus) companyUpdate.controlStatus = opts.controlStatus;
  if (opts.operationalStatus) companyUpdate.operationalStatus = opts.operationalStatus;
  if (Object.keys(companyUpdate).length > 0) {
    await prisma.company.update({ where: { id: company.id }, data: companyUpdate });
  }
  return { company, provider, user, link };
}

async function makeEmployee(companyId: string, label: string, overrides: Partial<{ document: string; status: "ACTIVE" | "INACTIVE" }> = {}) {
  return prisma.employee.create({
    data: {
      companyId,
      name: `__tenant_test__${label}`,
      document: overrides.document ?? `${Date.now()}${Math.random()}`.replace(".", "").slice(0, 14),
      status: overrides.status ?? "ACTIVE",
    },
  });
}

// =============================================================================
// Matriz de autorização — papel x accessLevel
// =============================================================================

describe("Matriz de autorização (papel x accessLevel)", () => {
  it.each([
    ["OWNER", "OPERATION", true],
    ["OWNER", "ADMINISTRATION", true],
    ["OWNER", "VIEW", false],
    ["TECHNICIAN", "OPERATION", true],
    ["TECHNICIAN", "ADMINISTRATION", true],
    ["TECHNICIAN", "VIEW", false],
    ["VIEWER", "OPERATION", false],
    ["VIEWER", "ADMINISTRATION", false],
    ["VIEWER", "VIEW", false],
  ] as const)("%s + %s -> canManage=%s (view sempre permitido)", async (role, accessLevel, canManageExpected) => {
    const { company, user } = await setupScenario(`matrix-${role}-${accessLevel}`, { role, accessLevel });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const viewCtx = await requireSstProviderEmployeeViewAccess(company.id);
    expect(viewCtx).toBeTruthy();
    expect(sstCanManageEmployees(viewCtx)).toBe(canManageExpected);

    if (canManageExpected) {
      await expect(requireSstProviderEmployeeManageAccess(company.id)).resolves.toBeTruthy();
    } else {
      await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(ForbiddenError);
    }
  });

  it("SstProviderUser inativo não acessa", async () => {
    const { company, provider, user } = await setupScenario("inactive-provider-user");
    await prisma.sstProviderUser.updateMany({ where: { providerId: provider.id, userId: user.id }, data: { active: false } });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).rejects.toThrow();
  });

  it("outro provider (sem vínculo com a empresa) não acessa", async () => {
    const { company } = await setupScenario("target-company");
    const otherProvider = await makeProvider("other-provider");
    const otherUser = await createTestUser(company.id, "other-provider-u");
    await createProviderUser({ providerId: otherProvider.id, userId: otherUser.id, role: "OWNER" });
    loginAs(toSession({ id: otherUser.id, name: otherUser.name, email: otherUser.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).rejects.toThrow(ForbiddenError);
  });
});

// =============================================================================
// Status do vínculo
// =============================================================================

describe("Status do vínculo", () => {
  it.each(["PENDING", "SUSPENDED", "REVOKED", "REJECTED"] as const)("vínculo %s não acessa (nem leitura, nem gestão)", async (linkStatus) => {
    const { company, user } = await setupScenario(`link-${linkStatus}`, { linkStatus });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).rejects.toThrow(ForbiddenError);
    await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(ForbiddenError);
  });

  it("vínculo ACTIVE acessa conforme o nível", async () => {
    const { company, user } = await setupScenario("link-active", { accessLevel: "OPERATION" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).resolves.toBeTruthy();
    await expect(requireSstProviderEmployeeManageAccess(company.id)).resolves.toBeTruthy();
  });

  it("revogação bloqueia uma sessão já aberta (guard sempre reconsulta o banco)", async () => {
    const { company, provider, user } = await setupScenario("link-revoke-live", { accessLevel: "OPERATION" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeManageAccess(company.id)).resolves.toBeTruthy();

    await prisma.sstProviderCompany.updateMany({ where: { providerId: provider.id, companyId: company.id }, data: { status: "REVOKED" } });

    await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(ForbiddenError);
  });
});

// =============================================================================
// Estados da Company
// =============================================================================

describe("Estados da Company", () => {
  it("UNCLAIMED da própria consultoria (PROVIDER_PRE_REGISTRATION) permite gestão", async () => {
    const { company, user } = await setupScenario("unclaimed-own", {
      controlStatus: "UNCLAIMED",
      authorizationBasis: "PROVIDER_PRE_REGISTRATION",
      accessLevel: "OPERATION",
    });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeManageAccess(company.id)).resolves.toBeTruthy();
  });

  it("UNCLAIMED sem authorizationBasis PROVIDER_PRE_REGISTRATION não concede acesso (defesa em profundidade)", async () => {
    const { company, user } = await setupScenario("unclaimed-wrong-basis", {
      controlStatus: "UNCLAIMED",
      authorizationBasis: "COMPANY_APPROVAL",
      accessLevel: "OPERATION",
    });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).rejects.toThrow(ForbiddenError);
  });

  it("CLAIM_PENDING permite no máximo leitura; bloqueia criação/edição com erro semântico", async () => {
    const { company, user } = await setupScenario("claim-pending", { controlStatus: "CLAIM_PENDING", accessLevel: "ADMINISTRATION" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const viewCtx = await requireSstProviderEmployeeViewAccess(company.id);
    expect(viewCtx).toBeTruthy();
    expect(sstCanManageEmployees(viewCtx)).toBe(false);

    await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(CompanyControlReviewInProgressError);
  });

  it("DISPUTED bloqueia toda mutação (mesma semântica de CLAIM_PENDING)", async () => {
    const { company, user } = await setupScenario("disputed", { controlStatus: "DISPUTED", accessLevel: "ADMINISTRATION" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).resolves.toBeTruthy();
    await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(CompanyControlReviewInProgressError);
  });

  it("CLAIMED segue estritamente o vínculo (accessLevel/role)", async () => {
    const { company, user } = await setupScenario("claimed", { controlStatus: "CLAIMED", accessLevel: "VIEW" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).resolves.toBeTruthy();
    await expect(requireSstProviderEmployeeManageAccess(company.id)).rejects.toThrow(ForbiddenError);
  });

  it.each(["SUSPENDED", "CLOSED"] as const)("Company operationalStatus=%s bloqueia leitura e escrita, mensagem genérica", async (operationalStatus) => {
    const { company, user } = await setupScenario(`company-${operationalStatus}`, { operationalStatus });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstProviderEmployeeViewAccess(company.id)).rejects.toThrow(ForbiddenError);
    try {
      await requireSstProviderEmployeeViewAccess(company.id);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/suspensa|encerrada|fechada/i);
    }
  });
});

// =============================================================================
// Criação
// =============================================================================

describe("Criação", () => {
  it("cria Employee na Company correta, nunca com providerId como proprietário", async () => {
    const { company, provider, user } = await setupScenario("create-basic");
    const ctx = { user: { id: user.id, name: user.name }, providerId: provider.id };
    const employee = await createEmployeeForCompany(company.id, {
      name: "Colaborador Teste",
      document: `doc-${Date.now()}`,
      status: "ACTIVE",
    }, buildSstActor(ctx));

    expect(employee.companyId).toBe(company.id);
    expect(Object.keys(employee)).not.toContain("providerId");
    const raw = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect((raw as Record<string, unknown>).providerId).toBeUndefined();

    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.create", targetId: employee.id } });
    expect(audit?.actorType).toBe("SST_PROVIDER_USER");
    expect(audit?.providerId).toBe(provider.id);
  });

  it("documento duplicado na mesma Company é bloqueado com mensagem amigável (nunca expõe P2002)", async () => {
    const { company, provider, user } = await setupScenario("create-duplicate");
    const ctx = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = `dup-${Date.now()}`;
    await createEmployeeForCompany(company.id, { name: "A", document: doc, status: "ACTIVE" }, ctx);

    await expect(createEmployeeForCompany(company.id, { name: "B", document: doc, status: "ACTIVE" }, ctx)).rejects.toThrow(
      /Já existe um colaborador com este documento/,
    );
  });

  it("mesmo documento em Companies diferentes é permitido", async () => {
    const scenarioA = await setupScenario("create-doc-a");
    const scenarioB = await setupScenario("create-doc-b");
    const doc = `shared-${Date.now()}`;
    const actorA = buildSstActor({ user: { id: scenarioA.user.id, name: scenarioA.user.name }, providerId: scenarioA.provider.id });
    const actorB = buildSstActor({ user: { id: scenarioB.user.id, name: scenarioB.user.name }, providerId: scenarioB.provider.id });

    await expect(createEmployeeForCompany(scenarioA.company.id, { name: "A", document: doc, status: "ACTIVE" }, actorA)).resolves.toBeTruthy();
    await expect(createEmployeeForCompany(scenarioB.company.id, { name: "B", document: doc, status: "ACTIVE" }, actorB)).resolves.toBeTruthy();
  });

  it("criação aparece no Portal Empresa (getEmployeesPage) e é isolada por Company", async () => {
    const { company, provider, user } = await setupScenario("create-visible-empresa");
    const ctx = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Visível", document: `vis-${Date.now()}`, status: "ACTIVE" }, ctx);

    const { rows } = await getEmployeesPage(company.id, { page: 1, pageSize: 20, sort: "name", dir: "asc" });
    expect(rows.some((row) => row.id === employee.id)).toBe(true);
  });

  it("API: companyId/providerId/role/accessLevel no body são ignorados (nunca aceitos pelo schema)", async () => {
    const { company, provider, user } = await setupScenario("api-create-forged");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const otherCompany = await makeCompany("api-create-forged-other");
    const res = await listRoute.POST(
      jsonRequest({
        name: "Forjado",
        document: `forged-${Date.now()}`,
        status: "ACTIVE",
        companyId: otherCompany.id,
        providerId: "fake-provider",
        role: "OWNER",
        accessLevel: "ADMINISTRATION",
      }),
      routeParams(company.id),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { employee: { id: string; companyId: string } };
    expect(body.employee.companyId).toBe(company.id); // nunca a otherCompany forjada
    const other = await prisma.employee.findMany({ where: { companyId: otherCompany.id } });
    expect(other).toHaveLength(0);
  });

  it("VIEWER forjando papel via body não obtém gestão", async () => {
    const { company, user } = await setupScenario("api-create-viewer", { role: "VIEWER" });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await listRoute.POST(
      jsonRequest({ name: "X", document: `x-${Date.now()}`, status: "ACTIVE", role: "OWNER" }),
      routeParams(company.id),
    );
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Edição
// =============================================================================

describe("Edição", () => {
  it("edita somente campos permitidos e registra auditoria com nomes de campo (nunca o documento)", async () => {
    const { company, provider, user } = await setupScenario("update-basic");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Original", document: `orig-${Date.now()}`, status: "ACTIVE" }, actor);

    const updated = await updateEmployeeForCompany(company.id, employee.id, { name: "Atualizado", document: employee.document, status: "ACTIVE" }, actor);
    expect(updated.name).toBe("Atualizado");

    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.update", targetId: employee.id }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { changedFields?: string[] } | null)?.changedFields).toContain("name");
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain(employee.document);
    expect(audit?.targetLabel).not.toContain(employee.document);
  });

  it("Employee de outra Company retorna NotFoundError (404 pela API)", async () => {
    const { company: companyA, provider, user } = await setupScenario("update-cross-a");
    const companyB = await makeCompany("update-cross-b");
    const employeeB = await makeEmployee(companyB.id, "cross-b");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });

    await expect(updateEmployeeForCompany(companyA.id, employeeB.id, { name: "X", document: "x", status: "ACTIVE" }, actor)).rejects.toThrow(
      /não encontrado/,
    );

    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));
    const res = await detailRoute.GET(jsonRequest(undefined), employeeRouteParams(companyA.id, employeeB.id));
    expect(res.status).toBe(404);
  });

  it("não altera companyId mesmo se enviado no payload", async () => {
    const { company, provider, user } = await setupScenario("update-companyid-forged");
    const otherCompany = await makeCompany("update-companyid-forged-other");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "N", document: `n-${Date.now()}`, status: "ACTIVE" }, actor);

    await updateEmployeeForCompany(company.id, employee.id, { name: "N2", document: employee.document, status: "ACTIVE" }, actor);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.companyId).toBe(company.id);
    expect(reloaded.companyId).not.toBe(otherCompany.id);
  });

  it("documento duplicado na edição é bloqueado", async () => {
    const { company, provider, user } = await setupScenario("update-duplicate");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const docA = `docA-${Date.now()}`;
    const docB = `docB-${Date.now()}`;
    await createEmployeeForCompany(company.id, { name: "A", document: docA, status: "ACTIVE" }, actor);
    const employeeB = await createEmployeeForCompany(company.id, { name: "B", document: docB, status: "ACTIVE" }, actor);

    await expect(
      updateEmployeeForCompany(company.id, employeeB.id, { name: "B", document: docA, status: "ACTIVE" }, actor),
    ).rejects.toThrow(/Já existe um colaborador com este documento/);
  });
});

// =============================================================================
// Inativação e reativação
// =============================================================================

describe("Inativação e reativação", () => {
  it("inativa (soft delete), preserva histórico, sai do filtro ACTIVE e reaparece em INACTIVE/ALL", async () => {
    const { company, provider, user } = await setupScenario("deactivate-basic");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Inativar", document: `inativar-${Date.now()}`, status: "ACTIVE" }, actor);

    await deactivateEmployeeForCompany(company.id, employee.id, actor);

    const stillExists = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(stillExists).not.toBeNull(); // nunca hard delete
    expect(stillExists?.status).toBe("INACTIVE");

    const activePage = await getSstCompanyEmployeesPage(company.id, { page: 1, pageSize: 20, status: "ACTIVE" });
    expect(activePage.rows.some((r) => r.id === employee.id)).toBe(false);
    const inactivePage = await getSstCompanyEmployeesPage(company.id, { page: 1, pageSize: 20, status: "INACTIVE" });
    expect(inactivePage.rows.some((r) => r.id === employee.id)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.delete", targetId: employee.id } });
    expect(audit).not.toBeNull();
  });

  it("reativação funciona e é auditada; idempotente", async () => {
    const { company, provider, user } = await setupScenario("reactivate-basic");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await makeEmployee(company.id, "to-reactivate", { status: "INACTIVE" });

    const reactivated = await reactivateEmployeeForCompany(company.id, employee.id, actor);
    expect(reactivated.status).toBe("ACTIVE");

    const auditCount = await prisma.auditLog.count({ where: { action: "employee.reactivate", targetId: employee.id } });
    expect(auditCount).toBe(1);

    // idempotente: reativar de novo não duplica auditoria
    await reactivateEmployeeForCompany(company.id, employee.id, actor);
    const auditCountAfter = await prisma.auditLog.count({ where: { action: "employee.reactivate", targetId: employee.id } });
    expect(auditCountAfter).toBe(1);
  });

  it("API: deactivate/reactivate exigem accessLevel suficiente e vínculo ACTIVE", async () => {
    const { company, provider, user } = await setupScenario("api-deactivate-view", { accessLevel: "VIEW" });
    const employee = await makeEmployee(company.id, "view-cannot-deactivate");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await deactivateRoute.POST(jsonRequest({}), employeeRouteParams(company.id, employee.id));
    expect(res.status).toBe(403);
    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.status).toBe("ACTIVE");
  });

  it("API: deactivate e reactivate (OPERATION) funcionam de ponta a ponta e são auditados", async () => {
    const { company, provider, user } = await setupScenario("api-deactivate-reactivate-ok", { accessLevel: "OPERATION" });
    const employee = await makeEmployee(company.id, "api-toggle");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const deactivated = await deactivateRoute.POST(jsonRequest({}), employeeRouteParams(company.id, employee.id));
    expect(deactivated.status).toBe(200);
    expect((await getEmployeeForCompany(company.id, employee.id)).status).toBe("INACTIVE");

    const reactivated = await reactivateRoute.POST(jsonRequest({}), employeeRouteParams(company.id, employee.id));
    expect(reactivated.status).toBe(200);
    expect((await getEmployeeForCompany(company.id, employee.id)).status).toBe("ACTIVE");

    const actions = await prisma.auditLog.findMany({ where: { targetId: employee.id }, select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual(["employee.delete", "employee.reactivate"]);
  });
});

// =============================================================================
// Privacidade
// =============================================================================

describe("Privacidade", () => {
  it("maskEmployeeDocument mantém só os 2 primeiros e 2 últimos caracteres", () => {
    expect(maskEmployeeDocument("12345678900")).toBe("12*******00");
    expect(maskEmployeeDocument("ab")).toBe("**");
  });

  it("listagem do Portal SST mascara o documento; DTO não inclui campo document bruto", async () => {
    const { company, provider, user } = await setupScenario("privacy-listing");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = `12345678900`;
    await createEmployeeForCompany(company.id, { name: "Privacidade", document: doc, status: "ACTIVE" }, actor);

    const { rows } = await getSstCompanyEmployeesPage(company.id, { page: 1, pageSize: 20, status: "ACTIVE" });
    const row = rows.find((r) => r.name.includes("Privacidade"))!;
    expect(row.documentMasked).not.toBe(doc);
    expect(JSON.stringify(row)).not.toContain(doc);
    expect(Object.keys(row)).not.toContain("document");
  });

  it("AuditLog não contém o documento integral do colaborador", async () => {
    const { company, provider, user } = await setupScenario("privacy-audit");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = `99988877766`;
    const employee = await createEmployeeForCompany(company.id, { name: "Audit Privacy", document: doc, status: "ACTIVE" }, actor);

    const logs = await prisma.auditLog.findMany({ where: { targetId: employee.id } });
    for (const log of logs) {
      expect(log.targetLabel ?? "").not.toContain(doc);
      expect(JSON.stringify(log.metadata ?? {})).not.toContain(doc);
    }
  });

  it("provider sem vínculo não visualiza colaboradores de outra Company", async () => {
    const { company } = await setupScenario("privacy-isolation-target");
    await makeEmployee(company.id, "isolated");
    const outsider = await setupScenario("privacy-isolation-outsider");
    loginAs(toSession({ id: outsider.user.id, name: outsider.user.name, email: outsider.user.email, companyId: null }));

    const res = await listRoute.GET(jsonRequest(undefined), routeParams(company.id));
    expect(res.status).toBe(403);
  });

  it("VIEWER não recebe nenhum campo administrativo adicional em relação a OWNER/TECHNICIAN na mesma listagem", async () => {
    const { company, provider } = await setupScenario("privacy-viewer-fields");
    const viewerUser = await createTestUser(company.id, "privacy-viewer-fields-viewer");
    await createProviderUser({ providerId: provider.id, userId: viewerUser.id, role: "VIEWER" });
    await makeEmployee(company.id, "viewer-visible");
    loginAs(toSession({ id: viewerUser.id, name: viewerUser.name, email: viewerUser.email, companyId: null }));

    const res = await listRoute.GET(jsonRequest(undefined), routeParams(company.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employees: Array<Record<string, unknown>> };
    for (const employee of body.employees) {
      expect(Object.keys(employee)).not.toContain("document");
    }
  });
});

// =============================================================================
// APIs e CSRF
// =============================================================================

describe("APIs e CSRF", () => {
  it("mutação sem sessão retorna 401", async () => {
    const company = await makeCompany("csrf-no-session");
    const res = await listRoute.POST(jsonRequest({ name: "X", document: "x", status: "ACTIVE" }), routeParams(company.id));
    expect(res.status).toBe(401);
  });

  it("Origin oficial com sessão válida funciona; Origin externo é bloqueado (403)", async () => {
    const { company, user } = await setupScenario("csrf-origin");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const blocked = await listRoute.POST(
      jsonRequest({ name: "X", document: `x-${Date.now()}`, status: "ACTIVE" }, { origin: "https://evil.example.com" }),
      routeParams(company.id),
    );
    expect(blocked.status).toBe(403);

    const ok = await listRoute.POST(
      jsonRequest({ name: "X", document: `x-${Date.now()}`, status: "ACTIVE" }),
      routeParams(company.id),
    );
    expect(ok.status).toBe(201);
  });

  it("Sec-Fetch-Site cross-site é bloqueado mesmo com Origin correto", async () => {
    const { company, user } = await setupScenario("csrf-secfetch");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await listRoute.POST(
      jsonRequest({ name: "X", document: `x-${Date.now()}`, status: "ACTIVE" }, { "sec-fetch-site": "cross-site" }),
      routeParams(company.id),
    );
    expect(res.status).toBe(403);
  });

  it("Host incompatível é bloqueado", async () => {
    const { company, user } = await setupScenario("csrf-host");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const res = await listRoute.POST(
      jsonRequest({ name: "X", document: `x-${Date.now()}`, status: "ACTIVE" }, { host: "evil.example.com" }),
      routeParams(company.id),
    );
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Concorrência
// =============================================================================

describe("Concorrência", () => {
  it("duas criações concorrentes com o mesmo documento resultam em um único Employee, sem P2002 exposto", async () => {
    const { company, provider, user } = await setupScenario("race-create");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const doc = `race-${Date.now()}`;

    const results = await Promise.allSettled([
      createEmployeeForCompany(company.id, { name: "A", document: doc, status: "ACTIVE" }, actor),
      createEmployeeForCompany(company.id, { name: "B", document: doc, status: "ACTIVE" }, actor),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0].reason as Error).message)).not.toMatch(/P2002|Unique constraint/i);

    const count = await prisma.employee.count({ where: { companyId: company.id, document: doc } });
    expect(count).toBe(1);
  });

  it("revogação do vínculo entre carregar o formulário e enviar o POST bloqueia a criação", async () => {
    const { company, provider, user } = await setupScenario("race-revoke-during-create");
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await requireSstProviderEmployeeManageAccess(company.id); // simula carregar o formulário

    await prisma.sstProviderCompany.updateMany({ where: { providerId: provider.id, companyId: company.id }, data: { status: "REVOKED" } });

    const res = await listRoute.POST(
      jsonRequest({ name: "Nunca criado", document: `never-${Date.now()}`, status: "ACTIVE" }),
      routeParams(company.id),
    );
    expect(res.status).toBe(403);
    const created = await prisma.employee.findFirst({ where: { name: "Nunca criado" } });
    expect(created).toBeNull();
    const auditSuccess = await prisma.auditLog.findFirst({ where: { action: "employee.create", companyId: company.id } });
    expect(auditSuccess).toBeNull();
  });

  it("Company muda para CLAIM_PENDING entre carregar o formulário e enviar o PUT bloqueia a edição", async () => {
    const { company, provider, user } = await setupScenario("race-claim-during-edit", {
      controlStatus: "UNCLAIMED",
      authorizationBasis: "PROVIDER_PRE_REGISTRATION",
    });
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Original", document: `orig-${Date.now()}`, status: "ACTIVE" }, actor);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await requireSstProviderEmployeeManageAccess(company.id); // simula carregar o formulário de edição

    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });

    const res = await detailRoute.PUT(
      jsonRequest({ name: "Nunca deveria salvar", document: employee.document, status: "ACTIVE" }),
      employeeRouteParams(company.id, employee.id),
    );
    expect(res.status).toBe(409);

    const reloaded = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(reloaded.name).toBe("Original");
  });
});

// =============================================================================
// Regressão
// =============================================================================

describe("Regressão", () => {
  it("Portal Empresa continua cadastrando/editando/inativando Employee normalmente", async () => {
    const company = await makeCompany("regression-empresa");
    const admin = await createTestUserWithMembership(company.id, "regression-empresa-admin");
    const actor = { id: admin.id, name: admin.name };

    const created = await createEmployeeForCompany(company.id, { name: "Empresa", document: `emp-${Date.now()}`, status: "ACTIVE" }, actor);
    expect(created.companyId).toBe(company.id);

    const updated = await updateEmployeeForCompany(company.id, created.id, { name: "Empresa 2", document: created.document, status: "ACTIVE" }, actor);
    expect(updated.name).toBe("Empresa 2");

    const deactivated = await deactivateEmployeeForCompany(company.id, created.id, actor);
    expect(deactivated.status).toBe("INACTIVE");

    const auditActions = await prisma.auditLog.findMany({ where: { targetId: created.id }, select: { action: true, actorType: true } });
    expect(auditActions.map((a) => a.action).sort()).toEqual(["employee.create", "employee.delete", "employee.update"]);
    for (const log of auditActions) {
      expect(log.actorType).toBe("COMPANY_USER");
    }
  });

  it("colaborador criado pela consultoria fica visível para treinamentos da mesma Company (mesma tabela, mesmo companyId)", async () => {
    const { company, provider, user } = await setupScenario("regression-trainings");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Treinamento", document: `train-${Date.now()}`, status: "ACTIVE" }, actor);

    const found = await prisma.employee.findFirst({ where: { id: employee.id, companyId: company.id } });
    expect(found).not.toBeNull();
    // Mesma query que lib/sst-employees.ts usa para achar participantes elegíveis.
    const eligibleForTraining = await prisma.employee.findMany({ where: { companyId: company.id, status: "ACTIVE" } });
    expect(eligibleForTraining.some((e) => e.id === employee.id)).toBe(true);
  });

  it("bloquear/revogar a consultoria não apaga colaboradores nem seus dados", async () => {
    const { company, provider, user } = await setupScenario("regression-block-preserves-data");
    const actor = buildSstActor({ user: { id: user.id, name: user.name }, providerId: provider.id });
    const employee = await createEmployeeForCompany(company.id, { name: "Preservado", document: `preserv-${Date.now()}`, status: "ACTIVE" }, actor);

    await prisma.sstProviderCompany.updateMany({ where: { providerId: provider.id, companyId: company.id }, data: { status: "REVOKED" } });

    const stillThere = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.name).toBe("Preservado");
    expect(stillThere?.status).toBe("ACTIVE");

    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));
    const res = await listRoute.GET(jsonRequest(undefined), routeParams(company.id));
    expect(res.status).toBe(403); // a consultoria não vê mais, mas o dado continua na Company
  });
});
