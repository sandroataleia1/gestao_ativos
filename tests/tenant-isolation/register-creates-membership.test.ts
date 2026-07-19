import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";
import { withValidCheckDigits } from "@/lib/cnpj";

/** CNPJ fictício, válido e único por execução (base derivada do timestamp,
 * truncada a 12 dígitos) — Sprint Comercial SST 1.4 tornou o CNPJ
 * obrigatório em /api/register. */
function uniqueTestCnpj(): string {
  return withValidCheckDigits(Date.now().toString().slice(-12).padStart(12, "0"));
}

// A Sprint SST 1.4C introduziu a Contenção P0 (registro nunca concede
// acesso automático a partir de um CNPJ) descrita no histórico deste
// arquivo até então. Decisão de produto posterior revogou essa contenção
// deliberadamente: /api/register agora cria a CompanyClaimRequest e já a
// aprova na mesma requisição (mesmo `approveCompanyClaimRequest` usado por
// um Super Admin), sem fila de revisão humana. Este teste passou a provar o
// comportamento atual — reintroduzir uma trava aqui não é um bug a
// corrigir, é a política vigente.
//
// Este teste NÃO mocka @/lib/auth (precisa do fluxo real de signUpEmail do
// Better Auth) — por isso fica isolado num arquivo próprio, sem o
// `vi.mock("@/lib/auth", ...)` usado nos demais arquivos desta suíte.

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

describe("registro público auto-aprova a claim (sem fila de revisão humana)", () => {
  it("admin recém-registrado já tem CompanyMembership ACTIVE e papel ADMIN; a claim nasce APPROVED", async () => {
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
    expect(body.status).toBe("ACTIVE");

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const claim = await prisma.companyClaimRequest.findFirstOrThrow({
      where: { requesterUserId: user.id },
    });
    createdCompanyIds.push(claim.companyId);
    expect(claim.status).toBe("APPROVED");
    expect(claim.origin).toBe("SELF_REGISTRATION");
    expect(claim.reviewedByUserId).toBe(user.id); // auto-aprovado pelo próprio requerente

    // `User.companyId` já aponta pra empresa, preenchido dentro de
    // approveCompanyClaimRequest depois de criar a membership real.
    expect(user.companyId).toBe(claim.companyId);

    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: user.id, companyId: claim.companyId } },
    });
    expect(membership.status).toBe("ACTIVE");

    const userRole = await prisma.userRole.findFirst({
      where: { userId: user.id, companyId: claim.companyId, role: { name: "ADMIN" } },
    });
    expect(userRole).not.toBeNull();

    const company = await prisma.company.findUniqueOrThrow({ where: { id: claim.companyId } });
    expect(company.controlStatus).toBe("CLAIMED");
    expect(company.claimedAt).not.toBeNull();
  });
});
