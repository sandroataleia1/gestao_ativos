import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  assignSystemRole,
  cleanupFixtures,
  createProviderUser,
  createTestCompanyWithRoles,
  createTestProvider,
  createTestUserWithMembership,
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

// Fixtures: um único usuário que é, AO MESMO TEMPO,
//  - membro do Portal Empresa (User.companyId = companyEmpresa, papel ADMIN);
//  - usuário de consultoria (SstProviderUser) de um provider que gerencia
//    OUTRA empresa (companyClient), nunca a companyEmpresa dele.
let companyEmpresa: { id: string };
let companyClient: { id: string };
let provider: { id: string };
let dualUser: TestSessionUser;

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  sstAuth = await import("@/lib/sst-auth");

  companyEmpresa = await createTestCompanyWithRoles("empresa");
  companyClient = await createTestCompanyWithRoles("client");

  const raw = await createTestUserWithMembership(companyEmpresa.id, "dual");
  await assignSystemRole(raw.id, companyEmpresa.id, "ADMIN");
  dualUser = toSessionUser(raw);

  provider = await createTestProvider("consultoria");
  await createProviderUser({ providerId: provider.id, userId: raw.id, role: "TECHNICIAN" });
  await linkProviderToCompany({
    providerId: provider.id,
    companyId: companyClient.id,
    status: "ACTIVE",
    accessLevel: "OPERATION",
  });
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({
    companyIds: [companyEmpresa.id, companyClient.id],
    providerIds: [provider.id],
  });
  await prisma.$disconnect();
});

describe("Caso 6 — separação entre Portal Empresa e Portal Consultoria", () => {
  it("Portal Consultoria resolve o tenant pelo SstProviderUser, não por User.companyId", async () => {
    loginAs(dualUser);

    const ctx = await sstAuth.requireSstAuth();

    // O tenant da consultoria é o provider — derivado de SstProviderUser.
    expect(ctx.providerId).toBe(provider.id);
    // E jamais é a empresa do usuário (User.companyId).
    expect(ctx.providerId).not.toBe(companyEmpresa.id);
    expect(ctx.sstProviderUser.userId).toBe(dualUser.id);
  });

  it("Portal Empresa resolve o tenant por User.companyId, independente da consultoria", async () => {
    loginAs(dualUser);

    const { companyId } = await authServer.requireCompany();

    expect(companyId).toBe(companyEmpresa.id);
    // O contexto de empresa nunca é o provider nem a empresa-cliente da consultoria.
    expect(companyId).not.toBe(provider.id);
    expect(companyId).not.toBe(companyClient.id);
  });

  it("estar no Portal Empresa NÃO concede poderes de consultoria sobre a própria empresa", async () => {
    loginAs(dualUser);

    // O provider gerencia companyClient (vínculo ACTIVE) — acesso concedido.
    const clientCtx = await sstAuth.requireSstProviderCompanyAccess(companyClient.id);
    expect(clientCtx.companyId).toBe(companyClient.id);

    // Mas o provider NÃO tem vínculo com a empresa do próprio usuário
    // (companyEmpresa). Ser ADMIN do Portal Empresa ali não vira acesso de
    // consultoria: precisa de um SstProviderCompany ACTIVE, que não existe.
    await expect(
      sstAuth.requireSstProviderCompanyAccess(companyEmpresa.id),
    ).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });

  it("os contextos não vazam dados entre si", async () => {
    loginAs(dualUser);

    // Contexto Empresa: a empresa do usuário.
    const empresaCtx = await authServer.requireCompany();
    // Contexto Consultoria: as empresas que o provider gerencia.
    const providerCtx = await sstAuth.requireSstAuth();

    // As duas resoluções partem de tabelas diferentes e chegam a tenants
    // diferentes — nenhuma reaproveita o identificador da outra.
    expect(empresaCtx.companyId).toBe(companyEmpresa.id);
    expect(providerCtx.providerId).toBe(provider.id);
    expect(empresaCtx.companyId).not.toBe(providerCtx.providerId);

    // A consultoria só alcança companyClient; a empresa do usuário permanece
    // fora do alcance da consultoria (provado acima), e a empresa-cliente não
    // é o tenant do Portal Empresa deste usuário.
    expect(empresaCtx.companyId).not.toBe(companyClient.id);
  });
});
