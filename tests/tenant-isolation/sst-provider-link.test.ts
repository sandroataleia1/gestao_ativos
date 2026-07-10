import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtures,
  createProviderUser,
  createTestCompany,
  createTestProvider,
  createTestUser,
  linkProviderToCompany,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies } from "@/tests/helpers/mock-request-context";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");
let sstAuth: typeof import("@/lib/sst-auth");

let provider: { id: string };
let providerUser: TestSessionUser;
// Uma empresa por cenário de vínculo.
let companyNoLink: { id: string };
let companyPending: { id: string };
let companySuspended: { id: string };
let companyRevoked: { id: string };
let companyActive: { id: string };

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  sstAuth = await import("@/lib/sst-auth");

  provider = await createTestProvider("prov");

  companyNoLink = await createTestCompany("nolink");
  companyPending = await createTestCompany("pending");
  companySuspended = await createTestCompany("suspended");
  companyRevoked = await createTestCompany("revoked");
  companyActive = await createTestCompany("active");

  // O usuário da consultoria precisa pertencer a alguma empresa (FK
  // User.companyId) — irrelevante para a lógica de consultoria.
  const raw = await createTestUser(companyActive.id, "provuser");
  await createProviderUser({ providerId: provider.id, userId: raw.id, role: "TECHNICIAN" });
  providerUser = toSessionUser(raw);

  await linkProviderToCompany({ providerId: provider.id, companyId: companyPending.id, status: "PENDING" });
  await linkProviderToCompany({ providerId: provider.id, companyId: companySuspended.id, status: "SUSPENDED" });
  await linkProviderToCompany({ providerId: provider.id, companyId: companyRevoked.id, status: "REVOKED" });
  await linkProviderToCompany({ providerId: provider.id, companyId: companyActive.id, status: "ACTIVE" });
  // companyNoLink: propositalmente sem SstProviderCompany.
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({
    companyIds: [
      companyNoLink.id,
      companyPending.id,
      companySuspended.id,
      companyRevoked.id,
      companyActive.id,
    ],
    providerIds: [provider.id],
  });
  await prisma.$disconnect();
});

describe("Caso 7 — consultoria sem vínculo ativo não acessa a empresa", () => {
  const denied: Array<[string, () => string]> = [
    ["sem SstProviderCompany", () => companyNoLink.id],
    ["vínculo PENDING", () => companyPending.id],
    ["vínculo SUSPENDED", () => companySuspended.id],
    ["vínculo REVOKED", () => companyRevoked.id],
  ];

  for (const [label, getCompanyId] of denied) {
    it(`nega acesso quando ${label} (ForbiddenError, sem dados)`, async () => {
      loginAs(providerUser);

      const promise = sstAuth.requireSstProviderCompanyAccess(getCompanyId());

      // A arquitetura nega lançando ForbiddenError (convertido em 403 pelo
      // handleApiError / forbidden() nas páginas) — nunca devolve o vínculo.
      await expect(promise).rejects.toBeInstanceOf(authServer.ForbiddenError);
    });
  }

  it("concede acesso apenas quando o vínculo está ACTIVE (controle)", async () => {
    loginAs(providerUser);

    const ctx = await sstAuth.requireSstProviderCompanyAccess(companyActive.id);
    expect(ctx.companyId).toBe(companyActive.id);
    expect(ctx.link.status).toBe("ACTIVE");
  });
});
