import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";
import { withValidCheckDigits } from "@/lib/cnpj";

/** CNPJ fictício, válido e único por execução (base derivada do timestamp,
 * truncada a 12 dígitos) — Sprint Comercial SST 1.4 tornou o CNPJ
 * obrigatório em /api/register. */
function uniqueTestCnpj(): string {
  return withValidCheckDigits(Date.now().toString().slice(-12).padStart(12, "0"));
}

// Sprint SST 1.4C — este arquivo cobria antes a regressão inversa (Sprint
// 0.6: garantir que o registro CRIASSE uma CompanyMembership ACTIVE). Essa
// premissa virou exatamente a vulnerabilidade corrigida nesta sprint: só
// conhecer um CNPJ válido não pode mais conceder acesso administrativo
// imediato. Reescrito para provar o oposto — registro NUNCA cria
// CompanyMembership/papel ADMIN diretamente; cria só uma CompanyClaimRequest
// PENDING, e o usuário recém-registrado fica corretamente bloqueado do
// Portal Empresa até uma aprovação explícita (ver
// lib/company-claim-request.ts:approveCompanyClaimRequest).
//
// Este teste NÃO mocka @/lib/auth (precisa do fluxo real de signUpEmail do
// Better Auth) — por isso fica isolado num arquivo próprio, sem o
// `vi.mock("@/lib/auth", ...)` usado nos demais arquivos desta suíte. Por
// não mockar @/lib/auth, também não mocka next/headers/cookies — por isso
// chama requireCompany() sem passar por um Route Handler real (o teste do
// bloqueio em si é feito diretamente contra o resolver).

const createdCompanyIds: string[] = [];
const createdUserEmails: string[] = [];

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: createdUserEmails } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.companyClaimRequest.deleteMany({ where: { requesterUserId: { in: userIds } } });
    await prisma.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.companyClaimRequest.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.role.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetStatus.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetCondition.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.location.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.locationType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.movementType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  await prisma.$disconnect();
});

describe("Sprint SST 1.4C — registro nunca concede acesso automático a partir do CNPJ", () => {
  it("admin recém-registrado NÃO tem CompanyMembership nem papel ADMIN; tem só uma CompanyClaimRequest PENDING", async () => {
    const route = await import("@/app/api/register/route");

    const email = `__tenant_test__register-${Date.now()}@example.test`;
    createdUserEmails.push(email);

    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "__tenant_test__ Empresa Registro Automatico",
        cnpj: uniqueTestCnpj(),
        name: "Admin Registro Automatico",
        email,
        password: "RegisterTest@12345",
      }),
    });

    const res = await route.POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.status).toBe("CLAIM_REVIEW_REQUIRED");

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdCompanyIds.push(user.companyId);

    // Nunca cria CompanyMembership diretamente.
    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: user.companyId } },
    });
    expect(membership).toBeNull();

    // Nunca atribui papel ADMIN diretamente.
    const userRole = await prisma.userRole.findFirst({
      where: { userId: user.id, companyId: user.companyId, role: { name: "ADMIN" } },
    });
    expect(userRole).toBeNull();

    // Cria exatamente uma CompanyClaimRequest PENDING para (empresa, usuário).
    const claim = await prisma.companyClaimRequest.findUniqueOrThrow({
      where: { companyId_requesterUserId: { companyId: user.companyId, requesterUserId: user.id } },
    });
    expect(claim.status).toBe("PENDING");
    expect(claim.origin).toBe("SELF_REGISTRATION");

    // Company nasce CLAIM_PENDING (nunca CLAIMED automaticamente) — §9.
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.controlStatus).toBe("CLAIM_PENDING");
    expect(company.claimedAt).toBeNull();
  });
});
