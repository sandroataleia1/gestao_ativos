import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";
import { withValidCheckDigits } from "@/lib/cnpj";

/** CNPJ fictício, válido e único por chamada — mesma ideia do helper de
 * tests/tenant-isolation/register-creates-membership.test.ts, com um
 * contador monotônico extra para nunca colidir entre chamadas rápidas
 * dentro do mesmo milissegundo. */
let cnpjCounter = 0;
function uniqueTestCnpj(): string {
  cnpjCounter += 1;
  const base = (Date.now().toString() + cnpjCounter.toString().padStart(4, "0")).slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

// Cadastro público de consultoria SST (app/sst/register). Diferente do
// registro de empresa (Sprint SST 1.4C): concede acesso IMEDIATO como
// OWNER, sem CompanyClaimRequest/aprovação — decisão deliberada do
// usuário, documentada em docs/sst-providers.md. Este teste NÃO mocka
// @/lib/auth (precisa do fluxo real de signUpEmail do Better Auth) — mesmo
// motivo/isolamento de register-creates-membership.test.ts.

const createdUserEmails: string[] = [];
const createdProviderIds: string[] = [];

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: createdUserEmails } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.sstProviderUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.platformAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (createdProviderIds.length > 0) {
    await prisma.sstProviderUser.deleteMany({ where: { providerId: { in: createdProviderIds } } });
    await prisma.platformAuditLog.deleteMany({ where: { targetType: "SstProvider", targetId: { in: createdProviderIds } } });
    await prisma.sstProvider.deleteMany({ where: { id: { in: createdProviderIds } } });
  }
  await prisma.$disconnect();
});

function registerRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/sst/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sst/register", () => {
  it("cria SstProvider + User + SstProviderUser (OWNER, ativo) e audita em PlatformAuditLog", async () => {
    const route = await import("@/app/api/sst/register/route");
    const email = `__tenant_test__sst-register-${Date.now()}@example.test`;
    createdUserEmails.push(email);
    const cnpj = uniqueTestCnpj();

    const response = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria Registro",
        cnpj,
        name: "Responsável Registro",
        email,
        password: "SstRegisterTest@12345",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const providerUser = await prisma.sstProviderUser.findFirstOrThrow({ where: { userId: user.id } });
    createdProviderIds.push(providerUser.providerId);
    const provider = await prisma.sstProvider.findUniqueOrThrow({ where: { id: providerUser.providerId } });
    expect(provider.document?.replace(/\D/g, "")).toBe(cnpj.replace(/\D/g, ""));
    expect(providerUser.role).toBe("OWNER");
    expect(providerUser.active).toBe(true);

    const auditRow = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: "sst_provider.self_registered", targetId: provider.id },
    });
    expect(auditRow.actorUserId).toBe(user.id);
    expect(auditRow.source).toBe("WEB");
  });

  it("recusa CNPJ inválido", async () => {
    const route = await import("@/app/api/sst/register/route");
    const email = `__tenant_test__sst-register-invalid-cnpj-${Date.now()}@example.test`;

    const response = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria Invalida",
        cnpj: "00000000000000",
        name: "Alguém",
        email,
        password: "SstRegisterTest@12345",
      }),
    );

    expect(response.status).toBe(400);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("recusa senha curta", async () => {
    const route = await import("@/app/api/sst/register/route");
    const email = `__tenant_test__sst-register-short-pw-${Date.now()}@example.test`;

    const response = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria Senha Curta",
        cnpj: uniqueTestCnpj(),
        name: "Alguém",
        email,
        password: "curta",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("recusa email já existente", async () => {
    const route = await import("@/app/api/sst/register/route");
    const email = `__tenant_test__sst-register-dup-email-${Date.now()}@example.test`;
    createdUserEmails.push(email);

    const first = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria Primeira",
        cnpj: uniqueTestCnpj(),
        name: "Primeiro",
        email,
        password: "SstRegisterTest@12345",
      }),
    );
    expect(first.status).toBe(200);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    const firstProviderUser = await prisma.sstProviderUser.findFirstOrThrow({ where: { userId: firstUser.id } });
    createdProviderIds.push(firstProviderUser.providerId);

    const second = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria Segunda",
        cnpj: uniqueTestCnpj(),
        name: "Segundo",
        email,
        password: "SstRegisterTest@12345",
      }),
    );
    expect(second.status).toBe(409);
  });

  it("recusa CNPJ já cadastrado por outra consultoria", async () => {
    const route = await import("@/app/api/sst/register/route");
    const cnpj = uniqueTestCnpj();
    const emailA = `__tenant_test__sst-register-cnpj-a-${Date.now()}@example.test`;
    const emailB = `__tenant_test__sst-register-cnpj-b-${Date.now()}@example.test`;
    createdUserEmails.push(emailA, emailB);

    const first = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria CNPJ A",
        cnpj,
        name: "A",
        email: emailA,
        password: "SstRegisterTest@12345",
      }),
    );
    expect(first.status).toBe(200);
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: emailA } });
    const providerUserA = await prisma.sstProviderUser.findFirstOrThrow({ where: { userId: userA.id } });
    createdProviderIds.push(providerUserA.providerId);

    const second = await route.POST(
      registerRequest({
        providerName: "__tenant_test__ Consultoria CNPJ B",
        cnpj,
        name: "B",
        email: emailB,
        password: "SstRegisterTest@12345",
      }),
    );
    expect(second.status).toBe(409);
    const userB = await prisma.user.findUnique({ where: { email: emailB } });
    expect(userB).toBeNull();
  });

  it("concorrência: duas tentativas simultâneas com o mesmo CNPJ — só uma cria a consultoria", async () => {
    const route = await import("@/app/api/sst/register/route");
    const cnpj = uniqueTestCnpj();
    const emailA = `__tenant_test__sst-register-race-a-${Date.now()}@example.test`;
    const emailB = `__tenant_test__sst-register-race-b-${Date.now()}@example.test`;
    createdUserEmails.push(emailA, emailB);

    const results = await Promise.allSettled([
      route.POST(
        registerRequest({
          providerName: "__tenant_test__ Consultoria Race A",
          cnpj,
          name: "A",
          email: emailA,
          password: "SstRegisterTest@12345",
        }),
      ),
      route.POST(
        registerRequest({
          providerName: "__tenant_test__ Consultoria Race B",
          cnpj,
          name: "B",
          email: emailB,
          password: "SstRegisterTest@12345",
        }),
      ),
    ]);

    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : null));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);

    for (const result of results) {
      if (result.status === "rejected") {
        expect(String((result.reason as Error).message)).not.toMatch(/P2002|Unique constraint/i);
      }
    }

    const providers = await prisma.sstProvider.findMany({ where: { document: { not: null } } });
    const matching = providers.filter((p) => p.document?.replace(/\D/g, "") === cnpj.replace(/\D/g, ""));
    createdProviderIds.push(...matching.map((p) => p.id));
    expect(matching).toHaveLength(1);
  });
});
