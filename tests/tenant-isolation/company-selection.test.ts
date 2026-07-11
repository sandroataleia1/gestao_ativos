import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import {
  getLastDeletedCookieName,
  getLastSetCookieCall,
  mockCookies,
  resetCookieStore,
  setActiveCompanyCookie,
} from "@/tests/helpers/mock-request-context";
import { listAvailableCompanyContexts, listPendingCompanyInvitations } from "@/lib/company-selection";
import { companyTag } from "@/lib/cache";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");
let contextRoute: typeof import("@/app/api/company-context/route");
let employeesRoute: typeof import("@/app/api/employees/route");

const companyIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  contextRoute = await import("@/app/api/company-context/route");
  employeesRoute = await import("@/app/api/employees/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeCompany(label: string, overrides: { active?: boolean; operationalStatus?: "ACTIVE" | "SUSPENDED" | "CLOSED" } = {}) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  if (overrides.active !== undefined || overrides.operationalStatus !== undefined) {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        ...(overrides.active !== undefined ? { active: overrides.active } : {}),
        ...(overrides.operationalStatus !== undefined ? { operationalStatus: overrides.operationalStatus } : {}),
      },
    });
  }
  return company;
}

describe("Sprint 0.6, Parte I — listAvailableCompanyContexts / listPendingCompanyInvitations", () => {
  it("caso 4: lista retorna somente memberships ACTIVE com empresa disponível", async () => {
    const company = await makeCompany("sel-list-active");
    const user = await createTestUser(company.id, "sel-list-active");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const list = await listAvailableCompanyContexts(user.id);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ companyId: company.id });
    // Só os campos previstos — nunca CNPJ/documento/plano.
    expect(Object.keys(list[0]).sort()).toEqual(["companyId", "companyName", "membershipId"].sort());
  });

  it("caso 5: membership INVITED não aparece como selecionável", async () => {
    const company = await makeCompany("sel-list-invited");
    const user = await createTestUser(company.id, "sel-list-invited");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "INVITED" });

    const list = await listAvailableCompanyContexts(user.id);
    expect(list).toHaveLength(0);

    const invitations = await listPendingCompanyInvitations(user.id);
    expect(invitations).toHaveLength(1);
    expect(invitations[0].companyId).toBe(company.id);
  });

  it("caso 6: membership SUSPENDED ou REVOKED não aparece como selecionável", async () => {
    const companySuspended = await makeCompany("sel-list-suspended-m");
    const companyRevoked = await makeCompany("sel-list-revoked-m");
    const user = await createTestUser(companySuspended.id, "sel-list-susprev");
    await createTestMembership({ userId: user.id, companyId: companySuspended.id, status: "SUSPENDED" });
    await createTestMembership({ userId: user.id, companyId: companyRevoked.id, status: "REVOKED" });

    const list = await listAvailableCompanyContexts(user.id);
    expect(list).toHaveLength(0);
  });

  it("caso 7: empresa suspensa, encerrada ou active=false não aparece mesmo com membership ACTIVE", async () => {
    const companyInactive = await makeCompany("sel-list-inactive-flag", { active: false });
    const companySuspended = await makeCompany("sel-list-company-suspended", { operationalStatus: "SUSPENDED" });
    const companyClosed = await makeCompany("sel-list-company-closed", { operationalStatus: "CLOSED" });
    const user = await createTestUser(companyInactive.id, "sel-list-unavailable");
    await createTestMembership({ userId: user.id, companyId: companyInactive.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companySuspended.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companyClosed.id, status: "ACTIVE" });

    const list = await listAvailableCompanyContexts(user.id);
    expect(list).toHaveLength(0);
  });
});

describe("Sprint 0.6, Parte I — POST /api/company-context (seleção)", () => {
  it("caso 8: seleção válida grava cookie com os atributos esperados", async () => {
    const company = await makeCompany("sel-post-valid");
    const user = await createTestUser(company.id, "sel-post-valid");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));

    const req = new NextRequest("http://localhost/api/company-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: company.id }),
    });
    const res = await contextRoute.POST(req);
    expect(res.status).toBe(200);

    const setCall = getLastSetCookieCall();
    expect(setCall?.name).toBe("active_company_id");
    expect(setCall?.value).toBe(company.id); // só o ID, nada mais
    expect(setCall?.options?.httpOnly).toBe(true);
    expect(setCall?.options?.sameSite).toBe("lax");
    expect(setCall?.options?.path).toBe("/");
    expect(setCall?.options?.maxAge).toBeGreaterThan(0);
  });

  it("caso 9: seleção de empresa sem membership é 403", async () => {
    const companyWith = await makeCompany("sel-post-403-with");
    const companyWithout = await makeCompany("sel-post-403-without");
    const user = await createTestUser(companyWith.id, "sel-post-403");
    await createTestMembership({ userId: user.id, companyId: companyWith.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));

    const req = new NextRequest("http://localhost/api/company-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyWithout.id }),
    });
    const res = await contextRoute.POST(req);
    expect(res.status).toBe(403);
    expect(getLastSetCookieCall()).toBeNull();
  });

  it("caso 10: seleção de membership revogada é 403", async () => {
    const company = await makeCompany("sel-post-revoked");
    const user = await createTestUser(company.id, "sel-post-revoked");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "REVOKED" });
    loginAs(toSessionUser(user));

    const req = new NextRequest("http://localhost/api/company-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: company.id }),
    });
    const res = await contextRoute.POST(req);
    expect(res.status).toBe(403);
  });

  it("caso 18 (regra do body): companyId malicioso no body é validado pela membership do usuário da sessão, nunca aceito cegamente", async () => {
    const companyMine = await makeCompany("sel-post-mine");
    const companyOther = await makeCompany("sel-post-other-user");
    const otherUser = await createTestUser(companyOther.id, "sel-post-other-owner");
    await createTestMembership({ userId: otherUser.id, companyId: companyOther.id, status: "ACTIVE" });

    const user = await createTestUser(companyMine.id, "sel-post-attacker");
    await createTestMembership({ userId: user.id, companyId: companyMine.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));

    const req = new NextRequest("http://localhost/api/company-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyOther.id }),
    });
    const res = await contextRoute.POST(req);
    expect(res.status).toBe(403);
  });
});

describe("Sprint 0.6, Parte I — cookie inválido / GET / DELETE", () => {
  it("caso 11: cookie manipulado não faz fallback silencioso (GET mostra selectionRequired/currentCompany=null)", async () => {
    const companyLegacy = await makeCompany("sel-cookie-legacy");
    const companyOther = await makeCompany("sel-cookie-other");
    const user = await createTestUser(companyLegacy.id, "sel-cookie-invalid");
    await createTestMembership({ userId: user.id, companyId: companyLegacy.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));
    // Cookie aponta pra uma empresa sem membership nenhuma.
    setActiveCompanyCookie(companyOther.id);

    const res = await contextRoute.GET();
    const body = (await res.json()) as { currentCompany: unknown };
    expect(body.currentCompany).toBeNull();
  });

  it("caso 12: DELETE limpa o cookie explicitamente", async () => {
    const company = await makeCompany("sel-delete");
    const user = await createTestUser(company.id, "sel-delete");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));
    setActiveCompanyCookie(company.id);

    const req = new NextRequest("http://localhost/api/company-context", { method: "DELETE" });
    const res = await contextRoute.DELETE(req);
    expect(res.status).toBe(200);
    expect(getLastDeletedCookieName()).toBe("active_company_id");

    // Não revogou a membership nem alterou User.companyId.
    const membership = await prisma.companyMembership.findFirst({
      where: { userId: user.id, companyId: company.id },
    });
    expect(membership?.status).toBe("ACTIVE");
    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(freshUser?.companyId).toBe(company.id);
  });
});

describe("Sprint 0.6, Parte I — troca de contexto sem vazamento", () => {
  it("caso 13: usuário com duas empresas troca de contexto e cada uma só enxerga seus próprios dados", async () => {
    const companyA = await createTestCompanyWithRoles("sel-switch-A");
    const companyB = await createTestCompanyWithRoles("sel-switch-B");
    companyIds.push(companyA.id, companyB.id);
    const user = await createTestUser(companyA.id, "sel-switch");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });
    // Permissão EMPLOYEE_VIEW (via ADMIN) em AMBAS as empresas — a rota
    // /api/employees exige requirePermission, que agora também exige
    // membership ACTIVE + UserRole no MESMO contexto resolvido.
    await assignSystemRole(user.id, companyA.id, "ADMIN");
    await assignSystemRole(user.id, companyB.id, "ADMIN");

    const employeeA = await prisma.employee.create({
      data: { companyId: companyA.id, name: "__tenant_test__empA", document: `docA${Date.now()}` },
    });
    const employeeB = await prisma.employee.create({
      data: { companyId: companyB.id, name: "__tenant_test__empB", document: `docB${Date.now()}` },
    });

    loginAs(toSessionUser(user));

    // Sem cookie: cai na legada (companyA).
    const resA = await employeesRoute.GET(new NextRequest("http://localhost/api/employees"));
    const bodyA = (await resA.json()) as { employees: Array<{ id: string }> };
    expect(bodyA.employees.map((e) => e.id)).toContain(employeeA.id);
    expect(bodyA.employees.map((e) => e.id)).not.toContain(employeeB.id);

    // Troca explícita pra companyB.
    setActiveCompanyCookie(companyB.id);
    const resB = await employeesRoute.GET(new NextRequest("http://localhost/api/employees"));
    const bodyB = (await resB.json()) as { employees: Array<{ id: string }> };
    expect(bodyB.employees.map((e) => e.id)).toContain(employeeB.id);
    expect(bodyB.employees.map((e) => e.id)).not.toContain(employeeA.id);
  });

  it("caso 14: cache é isolado por tenant — a mesma tag nunca colide entre empresas diferentes", () => {
    const tagA = companyTag("company-a-id", "dashboard");
    const tagB = companyTag("company-b-id", "dashboard");
    expect(tagA).not.toBe(tagB);
    // A mesma empresa, mesmo escopo, sempre produz a MESMA tag (é assim que
    // a invalidação funciona) — só tenants diferentes divergem.
    expect(companyTag("company-a-id", "dashboard")).toBe(tagA);
  });
});

describe("Sprint 0.6, Parte I — página /select-company funciona com cookie inválido", () => {
  it("caso 15: resolveCurrentCompanyContext/listAvailableCompanyContexts/listPendingCompanyInvitations nunca lançam com cookie revogado", async () => {
    const company = await makeCompany("sel-page-invalid-cookie");
    const user = await createTestUser(company.id, "sel-page-invalid-cookie");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "REVOKED" });
    loginAs(toSessionUser(user));
    setActiveCompanyCookie("um-id-que-nao-existe-de-verdade");

    // As 3 chamadas que a página faz — nenhuma pode lançar.
    const [current, available, pending] = await Promise.all([
      authServer.resolveCurrentCompanyContext(),
      listAvailableCompanyContexts(user.id),
      listPendingCompanyInvitations(user.id),
    ]);

    expect(current?.status).toBe("INVALID_REQUESTED_CONTEXT");
    expect(available).toEqual([]);
    expect(pending).toEqual([]);
  });
});

describe("Sprint 0.6, Parte I — SELECTION_REQUIRED: página redireciona, API recebe código estável", () => {
  it("caso 16a: requireCompanyOrDeny() redireciona para /select-company quando há 2+ memberships ativas sem contexto explícito", async () => {
    const companyLegacy = await makeCompany("sel-required-page-legacy");
    const companyA = await makeCompany("sel-required-page-A");
    const companyB = await makeCompany("sel-required-page-B");
    // User.companyId (legado) aponta para uma empresa REAL (FK obrigatória),
    // mas SEM nenhuma membership lá — o resolver descarta a legada e cai no
    // fallback "no máximo 2 memberships ativas", que aqui encontra A e B:
    // ambíguo, sem preferência, exatamente o cenário de SELECTION_REQUIRED.
    const user = await createTestUser(companyLegacy.id, "sel-required-page");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));

    let redirected: { digest?: string } | null = null;
    try {
      await authServer.requireCompanyOrDeny();
    } catch (error) {
      redirected = error as { digest?: string };
    }

    expect(redirected).not.toBeNull();
    // `redirect()` do Next lança um erro com `digest` no formato
    // "NEXT_REDIRECT;...;/select-company;...".
    expect(redirected?.digest).toContain("/select-company");
  });

  it("caso 16b: API recebe 409 com code COMPANY_SELECTION_REQUIRED (nunca um redirect)", async () => {
    const companyLegacy = await makeCompany("sel-required-api-legacy");
    const companyA = await makeCompany("sel-required-api-A");
    const companyB = await makeCompany("sel-required-api-B");
    const user = await createTestUser(companyLegacy.id, "sel-required-api");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });
    loginAs(toSessionUser(user));

    const res = await contextRoute.GET();
    // GET não lança (é sempre "informativo") — mas confirma que o status
    // sinaliza a ambiguidade sem escolher uma empresa arbitrariamente.
    const body = (await res.json()) as { currentCompany: unknown; selectionRequired: boolean };
    expect(body.currentCompany).toBeNull();
    expect(body.selectionRequired).toBe(true);

    // Uma rota de negócio (que usa requirePermission -> requireCompany)
    // devolve 409 com o código estável, nunca um redirect/HTML.
    const employeesRes = await employeesRoute.GET(new NextRequest("http://localhost/api/employees"));
    expect(employeesRes.status).toBe(409);
    const employeesBody = (await employeesRes.json()) as { code?: string };
    expect(employeesBody.code).toBe("COMPANY_SELECTION_REQUIRED");
  });
});
