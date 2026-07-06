import { prisma } from "@/lib/prisma";

// Status/Condição de ativo não têm mais tela de cadastro/edição (ver
// app/(app)/assets/asset-form.tsx e histórico do módulo Cadastros) — são
// fixos, definidos só por seed. Isso só funciona se TODA empresa ganhar
// esses valores automaticamente, não só a empresa demo: sem isso, uma
// empresa criada via /register (cadastro público) nasce sem nenhum
// AssetStatus/AssetCondition e fica impossibilitada de cadastrar qualquer
// ativo (os Selects do formulário ficam vazios e não há mais "+" para criar
// um novo). Mesmo padrão de provisionDefaultRolesForCompany
// (lib/rbac-provisioning.ts): upsert idempotente, seguro rodar de novo.

export const DEFAULT_ASSET_STATUSES = [
  { name: "Disponível", color: "#16a34a" },
  { name: "Em uso", color: "#2563eb" },
  { name: "Em manutenção", color: "#d97706" },
] as const;

export const DEFAULT_ASSET_CONDITIONS = ["Novo", "Bom", "Regular"] as const;

export async function provisionDefaultAssetStatusesAndConditions(companyId: string) {
  const statuses = new Map<string, { id: string }>();
  for (const { name, color } of DEFAULT_ASSET_STATUSES) {
    const status = await prisma.assetStatus.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name, color },
    });
    statuses.set(name, status);
  }

  const conditions = new Map<string, { id: string }>();
  for (const name of DEFAULT_ASSET_CONDITIONS) {
    const condition = await prisma.assetCondition.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name },
    });
    conditions.set(name, condition);
  }

  return { statuses, conditions };
}
