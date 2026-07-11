import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createProviderUser,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestProvider,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let inviteRoute: typeof import("@/app/api/company-memberships/invite/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

beforeAll(async () => {
  inviteRoute = await import("@/app/api/company-memberships/invite/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeActor(label: string, role: "ADMIN" | "CONSULTA" = "ADMIN") {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  const user = await createTestUser(company.id, `${label}-actor`);
  await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
  await assignSystemRole(user.id, company.id, role);
  return { company, user };
}

function inviteRequest(body: unknown) {
  return new NextRequest("http://localhost/api/company-memberships/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const GENERIC_MESSAGE = "Caso exista uma conta elegível para esse endereço, o convite ficará disponível ao usuário.";

describe("Sprint 0.6, Parte I — POST /api/company-memberships/invite", () => {
  it("caso 17: ator sem permissão de gestão de usuários não convida", async () => {
    const { company, user } = await makeActor("inv-no-perm", "CONSULTA"); // CONSULTA não tem USER_MANAGE
    const targetCompany = await createTestCompanyWithRoles("inv-no-perm-target");
    companyIds.push(targetCompany.id);
    const target = await createTestUser(targetCompany.id, "inv-no-perm-target-user");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "CONSULTA" } });

    loginAs(toSessionUser(user));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));

    expect(res.status).toBe(403);
    const membership = await prisma.companyMembership.findFirst({ where: { userId: target.id, companyId: company.id } });
    expect(membership).toBeNull();
  });

  it("caso 18: companyId enviado maliciosamente no body é ignorado — convite sempre usa a empresa resolvida do ator", async () => {
    const { company: actorCompany, user: actor } = await makeActor("inv-body-company");
    const otherCompany = await createTestCompanyWithRoles("inv-body-company-other");
    companyIds.push(otherCompany.id);
    const target = await createTestUser(otherCompany.id, "inv-body-company-target");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: actorCompany.id, name: "ADMIN" } });

    loginAs(toSessionUser(actor));
    const res = await inviteRoute.POST(
      inviteRequest({ email: target.email, roleId: role.id, companyId: otherCompany.id }),
    );
    expect(res.status).toBe(200);

    // A membership criada é na empresa do ATOR, nunca na "otherCompany" do body.
    const membershipInActorCompany = await prisma.companyMembership.findFirst({
      where: { userId: target.id, companyId: actorCompany.id },
    });
    const membershipInOtherCompany = await prisma.companyMembership.findFirst({
      where: { userId: target.id, companyId: otherCompany.id },
    });
    expect(membershipInActorCompany?.status).toBe("INVITED");
    expect(membershipInOtherCompany).toBeNull();
  });

  it("caso 19: roleId de outra empresa é rejeitado", async () => {
    const { company: actorCompany, user: actor } = await makeActor("inv-role-other");
    const otherCompany = await createTestCompanyWithRoles("inv-role-other-target");
    companyIds.push(otherCompany.id);
    const target = await createTestUser(otherCompany.id, "inv-role-other-user");
    const roleFromOtherCompany = await prisma.role.findFirstOrThrow({
      where: { companyId: otherCompany.id, name: "ADMIN" },
    });

    loginAs(toSessionUser(actor));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: roleFromOtherCompany.id }));

    expect(res.status).toBe(400);
    const membership = await prisma.companyMembership.findFirst({
      where: { userId: target.id, companyId: actorCompany.id },
    });
    expect(membership).toBeNull();
  });

  it("caso 20: e-mail inexistente e existente produzem resposta externa indistinguível", async () => {
    const { company, user: actor } = await makeActor("inv-enum");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const existingTarget = await createTestUser(company.id, "inv-enum-existing");

    loginAs(toSessionUser(actor));

    const resNonExistent = await inviteRoute.POST(
      inviteRequest({ email: `nao-existe-${Date.now()}@example.test`, roleId: role.id }),
    );
    const resExisting = await inviteRoute.POST(inviteRequest({ email: existingTarget.email, roleId: role.id }));

    expect(resNonExistent.status).toBe(resExisting.status);
    const bodyNonExistent = await resNonExistent.json();
    const bodyExisting = await resExisting.json();
    expect(bodyNonExistent).toEqual(bodyExisting);
    expect(bodyNonExistent.message).toBe(GENERIC_MESSAGE);
  });

  it("caso 21: usuário existente elegível recebe membership INVITED com UserRole correspondente", async () => {
    const { company, user: actor } = await makeActor("inv-happy");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-happy-target");

    loginAs(toSessionUser(actor));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));
    expect(res.status).toBe(200);

    const membership = await prisma.companyMembership.findFirst({
      where: { userId: target.id, companyId: company.id },
    });
    expect(membership?.status).toBe("INVITED");
    expect(membership?.invitedByUserId).toBe(actor.id);
    expect(membership?.activatedAt).toBeNull();

    const userRole = await prisma.userRole.findFirst({
      where: { userId: target.id, companyId: company.id, roleId: role.id },
    });
    expect(userRole).not.toBeNull();
  });

  it("caso 22: convite não altera User.companyId do convidado", async () => {
    const { company, user: actor } = await makeActor("inv-companyid");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const targetOriginalCompany = await createTestCompanyWithRoles("inv-companyid-target-home");
    companyIds.push(targetOriginalCompany.id);
    const target = await createTestUser(targetOriginalCompany.id, "inv-companyid-target");

    loginAs(toSessionUser(actor));
    await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));

    const freshTarget = await prisma.user.findUnique({ where: { id: target.id } });
    expect(freshTarget?.companyId).toBe(targetOriginalCompany.id);
  });

  it("caso 23: convite não concede acesso antes da aceitação (membership continua INVITED, não ACTIVE)", async () => {
    const { company, user: actor } = await makeActor("inv-no-access-yet");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-no-access-yet-target");

    loginAs(toSessionUser(actor));
    await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));

    const membership = await prisma.companyMembership.findFirst({
      where: { userId: target.id, companyId: company.id },
    });
    expect(membership?.status).toBe("INVITED");
    expect(membership?.status).not.toBe("ACTIVE");
  });

  it("caso 24: convite repetido é idempotente — não cria membership/papel duplicado", async () => {
    const { company, user: actor } = await makeActor("inv-idempotent");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-idempotent-target");

    loginAs(toSessionUser(actor));
    await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));
    const res2 = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));
    expect(res2.status).toBe(200);

    const memberships = await prisma.companyMembership.findMany({
      where: { userId: target.id, companyId: company.id },
    });
    expect(memberships).toHaveLength(1);
    const userRoles = await prisma.userRole.findMany({
      where: { userId: target.id, companyId: company.id },
    });
    expect(userRoles).toHaveLength(1);
  });

  it("caso 25: membership ACTIVE não é alterada por novo convite", async () => {
    const { company, user: actor } = await makeActor("inv-active-untouched");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-active-untouched-target");
    const activeMembership = await createTestMembership({
      userId: target.id,
      companyId: company.id,
      status: "ACTIVE",
    });

    loginAs(toSessionUser(actor));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));
    expect(res.status).toBe(200);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: activeMembership.id } });
    expect(fresh?.status).toBe("ACTIVE");
    expect(fresh?.updatedAt.getTime()).toBe(activeMembership.updatedAt.getTime());
  });

  it("caso 26: membership REVOKED não é reativada silenciosamente", async () => {
    const { company, user: actor } = await makeActor("inv-revoked-untouched");
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-revoked-untouched-target");
    const revokedMembership = await createTestMembership({
      userId: target.id,
      companyId: company.id,
      status: "REVOKED",
    });

    loginAs(toSessionUser(actor));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));
    expect(res.status).toBe(200);

    const fresh = await prisma.companyMembership.findUnique({ where: { id: revokedMembership.id } });
    expect(fresh?.status).toBe("REVOKED");
  });

  it("caso 27: SstProviderUser não concede permissão para convidar na empresa", async () => {
    const company = await createTestCompanyWithRoles("inv-sst-not-permission");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "inv-sst-not-permission-user");
    // NENHUM UserRole/permissão empresarial — só acesso ao Portal Consultoria.
    const provider = await createTestProvider("inv-sst-not-permission-prov");
    providerIds.push(provider.id);
    await createProviderUser({ providerId: provider.id, userId: user.id, role: "OWNER" });
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "ADMIN" } });
    const target = await createTestUser(company.id, "inv-sst-not-permission-target");

    loginAs(toSessionUser(user));
    const res = await inviteRoute.POST(inviteRequest({ email: target.email, roleId: role.id }));

    expect(res.status).toBe(403);
  });
});
