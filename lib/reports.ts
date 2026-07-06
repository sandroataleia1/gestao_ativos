import { prisma } from "@/lib/prisma";
import { getStockRows, type StockFilters } from "@/lib/stock";
import { custodyListInclude, serializeCustody, toNumber } from "@/lib/custodies";
import { isCustodyOverdue } from "@/lib/custodies/badge";
import { dateOnlyToEndOfDayISOStringSafe, dateOnlyToISOStringSafe } from "@/lib/date-only";

// Todo relatório aqui recebe `companyId` já resolvido da sessão (nunca do
// client) — mesma regra do resto do app. Nenhuma rota deste módulo escreve
// dado nenhum; são só agregações de leitura sobre os models já existentes.

function groupCount<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// `dateFrom`/`dateTo` vêm de `<input type="date">` (filtros de período) —
// nunca `new Date(dateFrom)` diretamente: `dateFrom` é o início do dia
// (meia-noite UTC do dia pretendido), mas `dateTo` precisa ser o **fim** do
// dia, senão um `lte` de meia-noite excluiria indevidamente qualquer
// registro daquele próprio dia final (ex.: uma custódia entregue às 14h no
// último dia do intervalo).
function dateRangeFilter(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: new Date(dateOnlyToISOStringSafe(dateFrom)) } : {}),
    ...(dateTo ? { lte: new Date(dateOnlyToEndOfDayISOStringSafe(dateTo)) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Ativos por categoria/status/condição
// ---------------------------------------------------------------------------

export type AssetsReportFilters = {
  categoryId?: string;
  statusId?: string;
  conditionId?: string;
  assetId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function getAssetsReport(companyId: string, filters: AssetsReportFilters = {}) {
  const { categoryId, statusId, conditionId, assetId, dateFrom, dateTo } = filters;
  const createdAtFilter = dateRangeFilter(dateFrom, dateTo);

  const assets = await prisma.asset.findMany({
    where: {
      companyId,
      ...(assetId ? { id: assetId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(statusId ? { statusId } : {}),
      ...(conditionId ? { conditionId } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    include: {
      category: { select: { name: true } },
      status: { select: { name: true, color: true } },
      condition: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows = assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    assetCode: asset.assetCode,
    category: asset.category.name,
    status: asset.status.name,
    condition: asset.condition.name,
    trackingMode: asset.trackingMode,
    active: asset.active,
    createdAt: asset.createdAt.toISOString(),
  }));

  return {
    rows,
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.active).length,
      inactive: rows.filter((row) => !row.active).length,
      byCategory: groupCount(rows, (row) => row.category),
      byStatus: groupCount(rows, (row) => row.status),
      byCondition: groupCount(rows, (row) => row.condition),
    },
  };
}

// ---------------------------------------------------------------------------
// Saldo de estoque por ativo/local
// ---------------------------------------------------------------------------

export type StockReportFilters = StockFilters;

export async function getStockReport(companyId: string, filters: StockReportFilters = {}) {
  const rows = await getStockRows(companyId, filters);

  return {
    rows,
    summary: {
      distinctAssets: new Set(rows.map((row) => row.assetId)).size,
      distinctLocations: new Set(rows.map((row) => row.locationId)).size,
      consumableQuantity: rows
        .filter((row) => row.asset.trackingMode === "CONSUMABLE")
        .reduce((sum, row) => sum + row.quantity, 0),
      individualUnits: rows
        .filter((row) => row.asset.trackingMode === "INDIVIDUAL")
        .reduce((sum, row) => sum + row.quantity, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Itens em posse por colaborador + custódias atrasadas
// ---------------------------------------------------------------------------

export type CustodiesReportFilters = {
  employeeId?: string;
  assetId?: string;
  status?: "ACTIVE" | "RETURNED";
  locationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function getCustodiesReport(companyId: string, filters: CustodiesReportFilters = {}) {
  const { employeeId, assetId, status, locationId, dateFrom, dateTo } = filters;
  const deliveredAtFilter = dateRangeFilter(dateFrom, dateTo);

  const custodies = await prisma.assetCustody.findMany({
    where: {
      companyId,
      ...(employeeId ? { employeeId } : {}),
      ...(assetId ? { assetId } : {}),
      ...(status ? { status } : {}),
      ...(locationId ? { holderLocationId: locationId } : {}),
      ...(deliveredAtFilter ? { deliveredAt: deliveredAtFilter } : {}),
    },
    include: custodyListInclude,
    orderBy: { deliveredAt: "desc" },
    take: 1000,
  });

  const rows = custodies.map((custody) => ({
    ...serializeCustody(custody),
    deliveredAt: custody.deliveredAt.toISOString(),
    expectedReturnAt: custody.expectedReturnAt ? custody.expectedReturnAt.toISOString() : null,
    returnedAt: custody.returnedAt ? custody.returnedAt.toISOString() : null,
    overdue: isCustodyOverdue({
      status: custody.status,
      expectedReturnAt: custody.expectedReturnAt,
    }),
  }));

  const activeRows = rows.filter((row) => row.status === "ACTIVE");

  const byEmployeeMap = new Map<
    string,
    { employeeId: string; name: string; items: number; quantity: number }
  >();
  for (const row of activeRows) {
    const existing = byEmployeeMap.get(row.employeeId);
    if (existing) {
      existing.items += 1;
      existing.quantity += row.quantity;
    } else {
      byEmployeeMap.set(row.employeeId, {
        employeeId: row.employeeId,
        name: row.employee.name,
        items: 1,
        quantity: row.quantity,
      });
    }
  }

  return {
    rows,
    summary: {
      total: rows.length,
      active: activeRows.length,
      overdue: activeRows.filter((row) => row.overdue).length,
      byEmployee: Array.from(byEmployeeMap.values()).sort((a, b) => b.quantity - a.quantity),
    },
  };
}

// ---------------------------------------------------------------------------
// CAs vencidos ou próximos do vencimento
// ---------------------------------------------------------------------------

export type ExpiringCaReportFilters = {
  assetId?: string;
  categoryId?: string;
  withinDays?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getExpiringCaReport(companyId: string, filters: ExpiringCaReportFilters = {}) {
  const { assetId, categoryId, withinDays = 30 } = filters;
  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * DAY_MS);

  const certifications = await prisma.assetCertification.findMany({
    where: {
      companyId,
      certificationType: "CA",
      status: { in: ["VALID", "EXPIRED"] },
      expirationDate: { not: null, lte: horizon },
      ...(assetId ? { assetId } : {}),
      ...(categoryId ? { asset: { categoryId } } : {}),
    },
    include: {
      asset: { select: { id: true, name: true, assetCode: true, category: { select: { name: true } } } },
    },
    orderBy: { expirationDate: "asc" },
  });

  const rows = certifications.map((certification) => {
    const expirationDate = certification.expirationDate!;
    const isExpired = expirationDate.getTime() < now.getTime();
    return {
      id: certification.id,
      assetId: certification.asset.id,
      assetName: certification.asset.name,
      assetCode: certification.asset.assetCode,
      category: certification.asset.category.name,
      certificationNumber: certification.certificationNumber,
      issuer: certification.issuer,
      expirationDate: expirationDate.toISOString(),
      daysUntilExpiration: Math.ceil((expirationDate.getTime() - now.getTime()) / DAY_MS),
      bucket: isExpired ? ("EXPIRED" as const) : ("EXPIRING_SOON" as const),
    };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      expired: rows.filter((row) => row.bucket === "EXPIRED").length,
      expiringSoon: rows.filter((row) => row.bucket === "EXPIRING_SOON").length,
    },
  };
}
