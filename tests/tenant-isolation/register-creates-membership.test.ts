import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";

// Regressão descoberta durante a validação manual da Sprint 0.6 (Parte J):
// POST /api/register nunca criava uma CompanyMembership para o admin
// recém-registrado — desde que CompanyMembership virou a fonte real de
// autorização (Sprint 0.5), isso deixava toda empresa auto-registrada com
// o próprio admin bloqueado (NO_ACTIVE_MEMBERSHIP) na primeira requisição.
//
// Este teste NÃO mocka @/lib/auth (precisa do fluxo real de signUpEmail do
// Better Auth) — por isso fica isolado num arquivo próprio, sem o
// `vi.mock("@/lib/auth", ...)` usado nos demais arquivos desta suíte.

const createdCompanyIds: string[] = [];
const createdUserEmails: string[] = [];

afterAll(async () => {
  // Cleanup manual (não usa tests/helpers/db.ts:cleanupFixtures porque os
  // usuários aqui são criados via Better Auth de verdade, não via factory
  // de teste — mas o prefixo/isolamento de dados é o mesmo princípio).
  const users = await prisma.user.findMany({ where: { email: { in: createdUserEmails } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (createdCompanyIds.length > 0) {
    // /api/register também provisiona Status/Condição/Local/Tipo de
    // movimentação padrão (lib/asset-lookup-provisioning.ts,
    // lib/stock-setup-provisioning.ts) — precisam ser limpos antes da
    // Company por causa das FKs.
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

describe("Sprint 0.6 — regressão: POST /api/register cria CompanyMembership ACTIVE", () => {
  it("admin recém-registrado tem uma CompanyMembership ACTIVE (não fica bloqueado)", async () => {
    const route = await import("@/app/api/register/route");

    const email = `__tenant_test__register-${Date.now()}@example.test`;
    createdUserEmails.push(email);

    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "__tenant_test__ Empresa Registro Automatico",
        name: "Admin Registro Automatico",
        email,
        password: "RegisterTest@12345",
      }),
    });

    const res = await route.POST(req);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdCompanyIds.push(user.companyId);

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: user.companyId } },
    });
    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.activatedAt).not.toBeNull();

    const userRole = await prisma.userRole.findFirst({
      where: { userId: user.id, companyId: user.companyId, role: { name: "ADMIN" } },
    });
    expect(userRole).not.toBeNull();
  });
});
