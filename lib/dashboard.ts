import { prisma } from "@/lib/prisma";
import { getStockRows, toNumber } from "@/lib/stock";
import { getCaAlerts, getCustodyOverdueAlerts, getLowStockAlerts } from "@/lib/alerts";

// Agregação única do dashboard — uma só ida ao banco por métrica, sem
// widgets independentes disparando suas próprias consultas. As três listas
// de alerta (CA, custódia atrasada, estoque baixo) são reaproveitadas tanto
// para o card "Alertas críticos" quanto para os indicadores operacionais,
// em vez de recalculadas por card.
export async function getDashboardSummary(companyId: string) {
  const now = new Date();

  const [stockRows, custodyAggregate, activeEmployeeCount] = await Promise.all([
    getStockRows(companyId),
    prisma.assetCustody.aggregate({
      where: { companyId, status: "ACTIVE" },
      _sum: { quantity: true },
    }),
    prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
  ]);

  const [caAlerts, custodyOverdueAlerts, lowStockAlerts] = await Promise.all([
    getCaAlerts(companyId, now),
    getCustodyOverdueAlerts(companyId, now),
    getLowStockAlerts(companyId, now, stockRows),
  ]);

  const criticalAlerts = [...caAlerts, ...custodyOverdueAlerts, ...lowStockAlerts].filter(
    (alert) => alert.severity === "CRITICAL",
  );

  return {
    inPossessionQuantity: toNumber(custodyAggregate._sum.quantity ?? 0),
    inStockQuantity: stockRows.reduce((sum, row) => sum + row.quantity, 0),
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
    activeEmployeeCount,
  };
}

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
