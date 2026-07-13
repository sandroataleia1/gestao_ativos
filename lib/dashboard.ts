import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { getStockSummary, toNumber } from "@/lib/stock";
import { type Alert, getCaAlerts, getCustodyOverdueAlerts, getLowStockAlerts } from "@/lib/alerts";

const SEVERITY_ORDER: Record<Alert["severity"], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export type QuickActionKey = "custody" | "stock" | "employee" | "asset";

export type QuickActionDefinition = {
  key: QuickActionKey;
  label: string;
  href: string;
};

const QUICK_ACTION_CATALOG: QuickActionDefinition[] = [
  { key: "custody", label: "Nova entrega", href: "/custodies/new" },
  { key: "stock", label: "Entrada de estoque", href: "/stock/new" },
  { key: "employee", label: "Novo colaborador", href: "/employees/new" },
  { key: "asset", label: "Novo ativo", href: "/assets/new" },
];

/**
 * Sprint Demo Comercial SST 1.2, Parte 8 — ordena as ações rápidas do
 * dashboard por prioridade fixa e remove as que o usuário não pode
 * executar. Função pura (sem JSX/ícone) para poder testar diretamente,
 * sem precisar renderizar a página — a interface (app/(app)/dashboard/
 * page.tsx) só combina o resultado com o ícone de cada `key` e decide
 * primário/secundário/"Mais ações" pela posição no array.
 */
export function buildDashboardQuickActions(permissions: {
  canManageCustody: boolean;
  canManageStock: boolean;
  canManageEmployee: boolean;
  canManageAsset: boolean;
}): QuickActionDefinition[] {
  const allowedKeys: Record<QuickActionKey, boolean> = {
    custody: permissions.canManageCustody,
    stock: permissions.canManageStock,
    employee: permissions.canManageEmployee,
    asset: permissions.canManageAsset,
  };
  return QUICK_ACTION_CATALOG.filter((action) => allowedKeys[action.key]);
}

// Dividido em duas funções (em vez de uma `getDashboardSummary` só) pra
// permitir que app/(app)/dashboard/page.tsx renderize os cards rápidos
// (aggregate/count, já eficientes) imediatamente e só envolva em
// `<Suspense>` a parte que depende dos 3 tipos de alerta — que é mais cara
// (CA a vencer olha certificações, custódia atrasada olha entregas, estoque
// baixo faz um groupBy) mesmo já otimizada. Ver docs/performance.md.

/** Cards rápidos: quantidade em posse/estoque — 2 queries aggregate/count,
 * nada que dependa de calcular alertas. */
export async function getDashboardFastSummary(companyId: string) {
  const [stockSummary, custodyAggregate] = await Promise.all([
    getStockSummary(companyId),
    prisma.assetCustody.aggregate({
      where: { companyId, status: "ACTIVE" },
      _sum: { quantity: true },
    }),
  ]);

  return {
    inPossessionQuantity: toNumber(custodyAggregate._sum.quantity ?? 0),
    inStockQuantity: stockSummary.consumableQuantity + stockSummary.individualUnits,
  };
}

/** Parte cara do dashboard (os 3 tipos de alerta) — `cache()` garante que,
 * mesmo se mais de um Server Component pedir isso na mesma requisição (ex.:
 * o card de alertas críticos e o de indicadores operacionais), as consultas
 * rodam uma única vez. */
export const getDashboardAlertsSummary = cache(async (companyId: string) => {
  const now = new Date();
  const [caAlerts, custodyOverdueAlerts, lowStockAlerts] = await Promise.all([
    getCaAlerts(companyId, now),
    getCustodyOverdueAlerts(companyId, now),
    getLowStockAlerts(companyId, now),
  ]);

  const allAlerts = [...caAlerts, ...custodyOverdueAlerts, ...lowStockAlerts];
  const criticalAlerts = allAlerts.filter((alert) => alert.severity === "CRITICAL");

  return {
    criticalAlerts,
    // Lista completa (WARNING + CRITICAL) das entregas atrasadas — diferente
    // de `criticalAlerts`, que só pega severidade CRITICAL (atraso > 7 dias)
    // e por isso deixava passar em branco, sem alerta nenhum no dashboard,
    // uma entrega recém-atrasada (1 a 7 dias).
    overdueCustodyAlerts: custodyOverdueAlerts,
    caExpiringSoonCount: caAlerts.filter((alert) => alert.type === "CA_EXPIRING_SOON").length,
    caExpiredCount: caAlerts.filter((alert) => alert.type === "CA_EXPIRED").length,
    overdueCustodyCount: custodyOverdueAlerts.length,
    lowStockCount: lowStockAlerts.length,
    // Sprint Demo Comercial SST 1.2, Parte 10 — lista única (todas as
    // severidades, todos os tipos) para a seção "Pendências prioritárias"
    // do dashboard, substituindo os blocos separados e sobrepostos que
    // existiam antes (mini-indicadores + "Entregas atrasadas" + "Alertas
    // críticos" mostravam a mesma custódia atrasada em até 3 lugares).
    // Mesmos dados já calculados acima — nenhuma consulta nova.
    priorityAlerts: allAlerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  };
});

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrada de estoque",
  EXIT: "Saída de estoque",
  DELIVERY: "Entrega",
  RETURN: "Devolução",
};

export type RecentMovement = {
  id: string;
  type: string;
  assetName: string;
  employeeName: string | null;
  executedAt: string;
  userName: string | null;
};

// "Últimas movimentações" — só AssetMovement e StockMovement (conforme
// definido), cada um limitado a `limit` linhas antes do merge (não busca a
// tabela inteira). Nomes de usuário responsável são resolvidos em uma única
// consulta extra (evita N+1 de um lookup por linha).
export async function getRecentMovements(companyId: string, limit = 10): Promise<RecentMovement[]> {
  const [stockMovements, assetMovements] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { companyId },
      select: {
        id: true,
        executedAt: true,
        executedBy: true,
        quantity: true,
        asset: { select: { name: true } },
        movementType: { select: { name: true } },
      },
      orderBy: { executedAt: "desc" },
      take: limit,
    }),
    prisma.assetMovement.findMany({
      where: { companyId },
      select: {
        id: true,
        executedAt: true,
        executedBy: true,
        asset: { select: { name: true } },
        movementType: { select: { name: true } },
        custody: { select: { employee: { select: { name: true } } } },
      },
      orderBy: { executedAt: "desc" },
      take: limit,
    }),
  ]);

  const userIds = [
    ...new Set(
      [...stockMovements, ...assetMovements]
        .map((movement) => movement.executedBy)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  const merged: RecentMovement[] = [
    ...stockMovements.map((movement) => ({
      id: `stock-${movement.id}`,
      type: MOVEMENT_TYPE_LABELS[movement.movementType.name] ?? movement.movementType.name,
      assetName: movement.asset.name,
      employeeName: null,
      executedAt: movement.executedAt.toISOString(),
      userName: movement.executedBy ? (userNameById.get(movement.executedBy) ?? null) : null,
    })),
    ...assetMovements.map((movement) => ({
      id: `asset-${movement.id}`,
      type: MOVEMENT_TYPE_LABELS[movement.movementType.name] ?? movement.movementType.name,
      assetName: movement.asset.name,
      employeeName: movement.custody?.employee.name ?? null,
      executedAt: movement.executedAt.toISOString(),
      userName: movement.executedBy ? (userNameById.get(movement.executedBy) ?? null) : null,
    })),
  ];

  return merged
    .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
    .slice(0, limit);
}
