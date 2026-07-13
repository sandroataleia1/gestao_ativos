import { afterAll, describe, expect, it } from "vitest";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { getLowStockAlerts } from "@/lib/alerts";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES } from "@/lib/permissions";

// Sprint Demo Comercial SST 1.2 — casos 9 e 10 da especificação: a
// reorganização visual do dashboard (Parte 10, "Pendências prioritárias")
// não pode vazar dados entre empresas, e a matriz de permissões (só
// consultada, nunca editada nesta sprint) precisa continuar exatamente a
// mesma.

const companyIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeCompanyWithLowStockAsset(label: string, quantity: number, minimumStock: number) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);

  const [{ statuses, conditions }, { location }] = await Promise.all([
    provisionDefaultAssetStatusesAndConditions(company.id),
    provisionDefaultStockSetup(company.id),
  ]);
  const category = await prisma.assetCategory.create({
    data: { companyId: company.id, name: `${label}-categoria` },
  });

  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      assetCode: `${label}-AC-001`,
      name: `${label} — item de estoque`,
      categoryId: category.id,
      statusId: statuses.get("Disponível")!.id,
      conditionId: conditions.get("Novo")!.id,
      trackingMode: "CONSUMABLE",
      minimumStock,
      active: true,
    },
  });

  await prisma.stockBalance.create({
    data: { companyId: company.id, assetId: asset.id, locationId: location.id, quantity },
  });

  return { company, asset };
}

describe("Sprint Demo Comercial SST 1.2, caso 9 — pendências prioritárias não vazam entre empresas", () => {
  it("alerta de estoque baixo de uma empresa nunca aparece na consulta de outra empresa", async () => {
    const now = new Date();
    const { company: companyA, asset: assetA } = await makeCompanyWithLowStockAsset("dash-alerts-a", 1, 10);
    const { company: companyB } = await makeCompanyWithLowStockAsset("dash-alerts-b", 5, 10);

    const alertsA = await getLowStockAlerts(companyA.id, now);
    const alertsB = await getLowStockAlerts(companyB.id, now);

    expect(alertsA.some((alert) => alert.resourceId === assetA.id)).toBe(true);
    // A empresa B tem saldo (5) igual/acima do próprio mínimo (10)? Não —
    // 5 < 10 também dispara alerta na PRÓPRIA empresa B; o que importa aqui
    // é que o alerta do ativo da empresa A nunca aparece na consulta da B.
    expect(alertsB.some((alert) => alert.resourceId === assetA.id)).toBe(false);
    expect(alertsA.every((alert) => alert.resourceId !== undefined)).toBe(true);
  });
});

describe("Sprint Demo Comercial SST 1.2, caso 10 — reorganização visual não altera a matriz de permissões", () => {
  it("o catálogo de permissões continua com exatamente as mesmas 28 chaves de antes desta sprint", () => {
    const keys = Object.values(PERMISSIONS);
    expect(keys).toHaveLength(28);
    expect(keys).toContain("training:view");
    expect(keys).toContain("sst_provider:manage");
  });

  it("ADMIN continua com todas as permissões; CONSULTA continua sem nenhuma permissão de escrita", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toHaveLength(Object.values(PERMISSIONS).length);
    const consultaManagePermissions = DEFAULT_ROLE_PERMISSIONS.CONSULTA.filter((key) => key.endsWith(":manage"));
    expect(consultaManagePermissions).toHaveLength(0);
  });

  it("um usuário GESTOR real continua sem asset:manage/employee:manage após a sprint (RBAC não foi tocado)", async () => {
    const company = await createTestCompanyWithRoles("dash-rbac-gestor");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "dash-rbac-gestor-user");
    await assignSystemRole(user.id, company.id, SYSTEM_ROLES.GESTOR);

    const role = await prisma.role.findFirstOrThrow({ where: { companyId: company.id, name: "GESTOR" } });
    const permissions = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const keys = permissions.map((rp) => rp.permission.key);
    expect(keys).not.toContain(PERMISSIONS.ASSET_MANAGE);
    expect(keys).not.toContain(PERMISSIONS.EMPLOYEE_MANAGE);
    expect(keys).toContain(PERMISSIONS.ASSET_VIEW);
  });
});
