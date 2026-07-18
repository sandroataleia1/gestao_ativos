import { afterAll, describe, expect, it } from "vitest";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestCompanyTraining,
  createTestTrainingClass,
  createTestEmployee,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { getLowStockAlerts, getTrainingExpiryAlerts } from "@/lib/alerts";
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

// =============================================================================
// Sprint SST 1.4H (fatia 1) — alertas de vencimento de treinamento.
// TrainingParticipant.expiresAt já era calculado desde a Sprint 2, mas
// nenhum alerta o lia até esta entrega. Mesmo padrão de isolamento e de
// regras (vencido = CRITICAL, a vencer em até 30 dias = WARNING) que os
// outros 3 tipos de alerta já têm.
// =============================================================================

async function makeParticipantWithExpiry(
  companyId: string,
  label: string,
  expiresAt: Date,
  overrides: Partial<{ enrollmentStatus: "ENROLLED" | "CANCELLED"; employeeStatus: "ACTIVE" | "INACTIVE" }> = {},
) {
  const employee = await createTestEmployee(companyId, label);
  if (overrides.employeeStatus === "INACTIVE") {
    await prisma.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });
  }
  const companyTraining = await createTestCompanyTraining(companyId, undefined, label);
  const trainingClass = await createTestTrainingClass(companyId, companyTraining.id, undefined, label);
  const participant = await prisma.trainingParticipant.create({
    data: {
      companyId,
      trainingClassId: trainingClass.id,
      employeeId: employee.id,
      enrollmentStatus: overrides.enrollmentStatus ?? "ENROLLED",
      resultStatus: "APPROVED",
      expiresAt,
      ...(overrides.enrollmentStatus === "CANCELLED" ? { cancelledAt: new Date() } : {}),
    },
  });
  return { employee, trainingClass, participant };
}

describe("Sprint SST 1.4H (fatia 1) — alertas de vencimento de treinamento", () => {
  it("treinamento vencido gera alerta CRITICAL/TRAINING_EXPIRED", async () => {
    const now = new Date();
    const company = await createTestCompanyWithRoles("training-alert-expired");
    companyIds.push(company.id);
    const { participant } = await makeParticipantWithExpiry(
      company.id,
      "expired",
      new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    );

    const alerts = await getTrainingExpiryAlerts(company.id, now);

    const found = alerts.find((alert) => alert.resourceId === participant.id);
    expect(found).toBeTruthy();
    expect(found?.type).toBe("TRAINING_EXPIRED");
    expect(found?.severity).toBe("CRITICAL");
  });

  it("treinamento vencendo em 15 dias gera alerta WARNING/TRAINING_EXPIRING_SOON", async () => {
    const now = new Date();
    const company = await createTestCompanyWithRoles("training-alert-soon");
    companyIds.push(company.id);
    const { participant } = await makeParticipantWithExpiry(
      company.id,
      "soon",
      new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
    );

    const alerts = await getTrainingExpiryAlerts(company.id, now);

    const found = alerts.find((alert) => alert.resourceId === participant.id);
    expect(found).toBeTruthy();
    expect(found?.type).toBe("TRAINING_EXPIRING_SOON");
    expect(found?.severity).toBe("WARNING");
  });

  it("treinamento vencendo em 60 dias (fora da janela de 30) não gera alerta", async () => {
    const now = new Date();
    const company = await createTestCompanyWithRoles("training-alert-far");
    companyIds.push(company.id);
    const { participant } = await makeParticipantWithExpiry(
      company.id,
      "far",
      new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
    );

    const alerts = await getTrainingExpiryAlerts(company.id, now);

    expect(alerts.some((alert) => alert.resourceId === participant.id)).toBe(false);
  });

  it("inscrição CANCELLED nunca gera alerta, mesmo vencida", async () => {
    const now = new Date();
    const company = await createTestCompanyWithRoles("training-alert-cancelled");
    companyIds.push(company.id);
    const { participant } = await makeParticipantWithExpiry(
      company.id,
      "cancelled",
      new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      { enrollmentStatus: "CANCELLED" },
    );

    const alerts = await getTrainingExpiryAlerts(company.id, now);

    expect(alerts.some((alert) => alert.resourceId === participant.id)).toBe(false);
  });

  it("colaborador INACTIVE nunca gera alerta, mesmo com inscrição ENROLLED vencida", async () => {
    const now = new Date();
    const company = await createTestCompanyWithRoles("training-alert-inactive-employee");
    companyIds.push(company.id);
    const { participant } = await makeParticipantWithExpiry(
      company.id,
      "inactive",
      new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      { employeeStatus: "INACTIVE" },
    );

    const alerts = await getTrainingExpiryAlerts(company.id, now);

    expect(alerts.some((alert) => alert.resourceId === participant.id)).toBe(false);
  });

  it("alerta de treinamento de uma empresa nunca aparece na consulta de outra empresa", async () => {
    const now = new Date();
    const companyA = await createTestCompanyWithRoles("training-alert-cross-a");
    companyIds.push(companyA.id);
    const companyB = await createTestCompanyWithRoles("training-alert-cross-b");
    companyIds.push(companyB.id);
    const { participant: participantA } = await makeParticipantWithExpiry(
      companyA.id,
      "cross-a",
      new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    );

    const alertsB = await getTrainingExpiryAlerts(companyB.id, now);

    expect(alertsB.some((alert) => alert.resourceId === participantA.id)).toBe(false);
  });
});
