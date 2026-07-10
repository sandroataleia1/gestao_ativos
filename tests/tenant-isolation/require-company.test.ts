import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtures,
  createProviderUser,
  createTestCompany,
  createTestMembership,
  createTestProvider,
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

const companyIds: string[] = [];
const providerIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeUserWithCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  const user = await createTestUser(company.id, label);
  return { company, user };
}

describe("requireCompany() — Sprint 0.5, Parte H", () => {
  it("caso 15: ausência de CompanyMembership bloqueia mesmo com User.companyId apontando pra empresa", async () => {
    const { company, user } = await makeUserWithCompany("rc-no-membership");
    // Nenhuma CompanyMembership criada — só o User.companyId legado.
    loginAs(toSessionUser(user));

    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
    void company;
  });

  it("caso 16: membership REVOKED bloqueia mesmo com sessão já válida", async () => {
    const { company, user } = await makeUserWithCompany("rc-revoked");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "REVOKED" });
    loginAs(toSessionUser(user));

    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });

  it("caso 17: cookie manipulado com empresa de OUTRO usuário é negado", async () => {
    const { company: companyA, user: userA } = await makeUserWithCompany("rc-cookie-attackerA");
    await createTestMembership({ userId: userA.id, companyId: companyA.id, status: "ACTIVE" });

    const { company: companyB, user: userB } = await makeUserWithCompany("rc-cookie-victimB");
    await createTestMembership({ userId: userB.id, companyId: companyB.id, status: "ACTIVE" });
    // userA NÃO tem nenhuma membership em companyB.

    loginAs(toSessionUser(userA));
    setActiveCompanyCookie(companyB.id);

    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
    void userB;
  });

  it("caso 18: cookie válido troca o contexto para a segunda empresa", async () => {
    const { company: companyA, user } = await makeUserWithCompany("rc-cookie-switchA");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });

    const companyB = await createTestCompany("rc-cookie-switchB");
    companyIds.push(companyB.id);
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });

    loginAs(toSessionUser(user));
    setActiveCompanyCookie(companyB.id);

    const ctx = await authServer.requireCompany();
    expect(ctx.companyId).toBe(companyB.id);
    expect(ctx.contextSource).toBe("REQUESTED");
  });

  it("caso 19: sem cookie, usuário legado continua acessando sua empresa atual", async () => {
    const { company, user } = await makeUserWithCompany("rc-no-cookie-legacy");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    loginAs(toSessionUser(user));
    // Sem setActiveCompanyCookie — cookie store vazio (resetado no afterEach anterior).

    const ctx = await authServer.requireCompany();
    expect(ctx.companyId).toBe(company.id);
    expect(ctx.contextSource).toBe("LEGACY");
  });

  it("caso 20: usuário com duas memberships e contexto explícito acessa SOMENTE a selecionada", async () => {
    const { company: companyA, user } = await makeUserWithCompany("rc-two-explicitA");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });

    const companyB = await createTestCompany("rc-two-explicitB");
    companyIds.push(companyB.id);
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });

    loginAs(toSessionUser(user));
    setActiveCompanyCookie(companyB.id);

    // Mesmo havendo 2 memberships ACTIVE (o que, sem contexto explícito,
    // exigiria SELECTION_REQUIRED — ver resolver puro caso 10), o cookie
    // válido resolve direto para a empresa pedida, nunca para a outra.
    const ctx = await authServer.requireCompany();
    expect(ctx.companyId).toBe(companyB.id);
    expect(ctx.companyId).not.toBe(companyA.id);
  });

  it("caso 27 (regressão): SstProviderUser não substitui CompanyMembership", async () => {
    const { user } = await makeUserWithCompany("rc-sst-not-membership");
    const provider = await createTestProvider("rc-sst-not-membership-prov");
    providerIds.push(provider.id);
    await createProviderUser({ providerId: provider.id, userId: user.id, role: "TECHNICIAN" });
    // Nenhuma CompanyMembership — só acesso ao Portal Consultoria.

    loginAs(toSessionUser(user));

    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });
});
