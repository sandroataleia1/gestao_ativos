import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { getStockSummary, toNumber } from "@/lib/stock";
import { getCaAlerts, getCustodyOverdueAlerts, getLowStockAlerts } from "@/lib/alerts";

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

  const criticalAlerts = [...caAlerts, ...custodyOverdueAlerts, ...lowStockAlerts].filter(
    (alert) => alert.severity === "CRITICAL",
  );

  return {
    criticalAlerts,
    // Lista completa (WARNING + CRITICAL) das entregas atrasadas — diferente
    // de `criticalAlerts`, que só pega severidade CRITICAL (atraso > 7 dias)
    // e por isso deixava passar em branco, sem alerta nenhum no dashboard,
    // uma entrega recém-atrasada (1 a 7 dias). Ver card "Entregas atrasadas"
    // em app/(app)/dashboard/page.tsx.
    overdueCustodyAlerts: custodyOverdueAlerts,
    caExpiringSoonCount: caAlerts.filter((alert) => alert.type === "CA_EXPIRING_SOON").length,
    caExpiredCount: caAlerts.filter((alert) => alert.type === "CA_EXPIRED").length,
    overdueCustodyCount: custodyOverdueAlerts.length,
    lowStockCount: lowStockAlerts.length,
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
