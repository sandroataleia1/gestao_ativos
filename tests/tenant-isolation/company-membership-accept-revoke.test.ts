import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore, setActiveCompanyCookie } from "@/tests/helpers/mock-request-context";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");
let acceptRoute: typeof import("@/app/api/company-memberships/[membershipId]/accept/route");
let revokeRoute: typeof import("@/app/api/company-memberships/[membershipId]/revoke-invitation/route");
let employeesRoute: typeof import("@/app/api/employees/route");

const companyIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  acceptRoute = await import("@/app/api/company-memberships/[membershipId]/accept/route");
  revokeRoute = await import("@/app/api/company-memberships/[membershipId]/revoke-invitation/route");
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

function acceptRequest(membershipId: string) {
  return {
    req: new NextRequest(`http://localhost/api/company-memberships/${membershipId}/accept`, { method: "POST" }),
    params: Promise.resolve({ membershipId }),
  };
}

function revokeRequest(membershipId: string) {
  return {
    req: new NextRequest(
      `http://localhost/api/company-memberships/${membershipId}/revoke-invitation`,
      { method: "POST" },
    ),
    params: Promise.resolve({ membershipId }),
  };
}

describe("Sprint 0.6, Parte I — POST /api/company-memberships/[id]/accept", () => {
  it("caso 28: somente o usuário convidado pode aceitar (outro usuário recebe 404, não revela existência)", async () => {
    const company = await createTestCompanyWithRoles("acc-only-invited");
    companyIds.push(company.id);
    const invited = await createTestUser(company.id, "acc-only-invited-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    const stranger = await createTestUser(company.id, "acc-only-invited-stranger");
    loginAs(toSessionUser(stranger));

    const { req, params } = acceptRequest(membership.id);
    const res = await acceptRoute.POST(req, { params });
    expect(res.status).toBe(404);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh?.status).toBe("INVITED");
  });

  it("caso 29: aceite muda INVITED -> ACTIVE e define activatedAt", async () => {
    const company = await createTestCompanyWithRoles("acc-happy");
    companyIds.push(company.id);
    const invited = await createTestUser(company.id, "acc-happy-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(invited));
    const { req, params } = acceptRequest(membership.id);
    const res = await acceptRoute.POST(req, { params });
    expect(res.status).toBe(200);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh?.status).toBe("ACTIVE");
    expect(fresh?.activatedAt).not.toBeNull();
  });

  it("caso 30: aceite sem papel válido (UserRole ausente) é bloqueado", async () => {
    const company = await createTestCompanyWithRoles("acc-no-role");
    companyIds.push(company.id);
    const invited = await createTestUser(company.id, "acc-no-role-target");
    // Membership INVITED SEM nenhum UserRole correspondente.
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });

    loginAs(toSessionUser(invited));
    const { req, params } = acceptRequest(membership.id);
    const res = await acceptRoute.POST(req, { params });
    expect(res.status).toBe(400);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh?.status).toBe("INVITED");
  });

  it("caso 31: aceite para empresa indisponível é bloqueado", async () => {
    const company = await createTestCompanyWithRoles("acc-company-unavailable");
    companyIds.push(company.id);
    await prisma.company.update({ where: { id: company.id }, data: { operationalStatus: "SUSPENDED" } });
    const invited = await createTestUser(company.id, "acc-company-unavailable-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(invited));
    const { req, params } = acceptRequest(membership.id);
    const res = await acceptRoute.POST(req, { params });
    expect(res.status).toBe(400);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh?.status).toBe("INVITED");
  });

  it("caso 32: aceite não altera User.companyId", async () => {
    const company = await createTestCompanyWithRoles("acc-companyid");
    companyIds.push(company.id);
    const homeCompany = await createTestCompanyWithRoles("acc-companyid-home");
    companyIds.push(homeCompany.id);
    const invited = await createTestUser(homeCompany.id, "acc-companyid-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(invited));
    const { req, params } = acceptRequest(membership.id);
    await acceptRoute.POST(req, { params });

    const fresh = await prisma.user.findUnique({ where: { id: invited.id } });
    expect(fresh?.companyId).toBe(homeCompany.id);
  });

  it("caso 33: após aceitar e selecionar via cookie, usuário acessa dados da segunda empresa", async () => {
    const homeCompany = await createTestCompanyWithRoles("acc-select-home");
    const secondCompany = await createTestCompanyWithRoles("acc-select-second");
    companyIds.push(homeCompany.id, secondCompany.id);
    const user = await createTestUser(homeCompany.id, "acc-select-user");
    await createTestMembership({ userId: user.id, companyId: homeCompany.id, status: "ACTIVE" });
    await assignSystemRole(user.id, homeCompany.id, "ADMIN");

    const role = await prisma.role.findFirstOrThrow({ where: { companyId: secondCompany.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: user.id, companyId: secondCompany.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: user.id, companyId: secondCompany.id, roleId: role.id } });

    const employeeSecond = await prisma.employee.create({
      data: { companyId: secondCompany.id, name: "__tenant_test__accSelectEmp", document: `accsel${Date.now()}` },
    });

    loginAs(toSessionUser(user));
    const { req, params } = acceptRequest(membership.id);
    const acceptRes = await acceptRoute.POST(req, { params });
    expect(acceptRes.status).toBe(200);

    // Seleção explícita (equivalente a POST /api/company-context) — aqui só
    // definimos o cookie diretamente, já que o próprio endpoint de seleção
    // já tem cobertura dedicada nos testes da Parte I (seleção).
    setActiveCompanyCookie(secondCompany.id);

    const res = await employeesRoute.GET(new NextRequest("http://localhost/api/employees"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { employees: Array<{ id: string }> };
    expect(body.employees.map((e) => e.id)).toContain(employeeSecond.id);
  });
});

describe("Sprint 0.6, Parte I — POST /api/company-memberships/[id]/revoke-invitation", () => {
  it("caso 34: cancelamento por administrador muda a membership para REVOKED", async () => {
    const company = await createTestCompanyWithRoles("rev-happy");
    companyIds.push(company.id);
    const admin = await createTestUser(company.id, "rev-happy-admin");
    await createTestMembership({ userId: admin.id, companyId: company.id, status: "ACTIVE" });
    await assignSystemRole(admin.id, company.id, "ADMIN");

    const invited = await createTestUser(company.id, "rev-happy-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(admin));
    const { req, params } = revokeRequest(membership.id);
    const res = await revokeRoute.POST(req, { params });
    expect(res.status).toBe(200);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh?.status).toBe("REVOKED");
    expect(fresh?.revokedAt).not.toBeNull();
  });

  it("caso 35: cancelamento remove o(s) UserRole criado(s) para o convite", async () => {
    const company = await createTestCompanyWithRoles("rev-remove-role");
    companyIds.push(company.id);
    const admin = await createTestUser(company.id, "rev-remove-role-admin");
    await createTestMembership({ userId: admin.id, companyId: company.id, status: "ACTIVE" });
    await assignSystemRole(admin.id, company.id, "ADMIN");

    const invited = await createTestUser(company.id, "rev-remove-role-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(admin));
    const { req, params } = revokeRequest(membership.id);
    await revokeRoute.POST(req, { params });

    const remainingRoles = await prisma.userRole.findMany({
      where: { userId: invited.id, companyId: company.id },
    });
    expect(remainingRoles).toHaveLength(0);

    // A linha da membership é preservada (histórico) — não é apagada.
    const fresh = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(fresh).not.toBeNull();
  });

  it("caso 36: membership revogada continua sem acesso mesmo com sessão válida", async () => {
    const company = await createTestCompanyWithRoles("rev-still-blocked");
    companyIds.push(company.id);
    const admin = await createTestUser(company.id, "rev-still-blocked-admin");
    await createTestMembership({ userId: admin.id, companyId: company.id, status: "ACTIVE" });
    await assignSystemRole(admin.id, company.id, "ADMIN");

    const invited = await createTestUser(company.id, "rev-still-blocked-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const membership = await createTestMembership({ userId: invited.id, companyId: company.id, status: "INVITED" });
    await prisma.userRole.create({ data: { userId: invited.id, companyId: company.id, roleId: role.id } });

    loginAs(toSessionUser(admin));
    const { req, params } = revokeRequest(membership.id);
    await revokeRoute.POST(req, { params });

    // O convidado tenta usar a sessão dele mesmo (revogado antes de aceitar)
    // — nunca ganha acesso, mesmo com uma sessão perfeitamente válida.
    loginAs(toSessionUser(invited));
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });
});
