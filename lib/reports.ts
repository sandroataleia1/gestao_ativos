import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getStockRows, type StockFilters } from "@/lib/stock";
import { custodyListInclude, serializeCustody, toNumber } from "@/lib/custodies";
import { isCustodyOverdue } from "@/lib/custodies/badge";
import { dateOnlyToEndOfDayISOStringSafe, dateOnlyToISOStringSafe } from "@/lib/date-only";

// Todo relatório aqui recebe `companyId` já resolvido da sessão (nunca do
// client) — mesma regra do resto do app. Nenhuma rota deste módulo escreve
// dado nenhum; são só agregações de leitura sobre os models já existentes.

// Teto de linhas exportadas/exibidas por relatório — os totais/somas do
// resumo (summary) NÃO dependem deste teto: vêm de count/groupBy separados
// no banco, então continuam corretos para a empresa inteira mesmo quando a
// tabela em si mostra só uma amostra (ver docs/performance.md).
const REPORT_ROW_LIMIT = 1000;

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

  const where: Prisma.AssetWhereInput = {
    companyId,
    ...(assetId ? { id: assetId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(statusId ? { statusId } : {}),
    ...(conditionId ? { conditionId } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  // Totais/quebras vêm de count/groupBy no banco (nunca de `.length`/reduce
  // sobre o array de linhas) — refletem a empresa inteira mesmo quando
  // `assets` abaixo é limitado a REPORT_ROW_LIMIT.
  const [assets, total, activeCount, byCategoryRaw, byStatusRaw, byConditionRaw, categories, statuses, conditions] =
    await Promise.all([
      prisma.asset.findMany({
        where,
        include: {
          category: { select: { name: true } },
          status: { select: { name: true, color: true } },
          condition: { select: { name: true } },
        },
        orderBy: { name: "asc" },
        take: REPORT_ROW_LIMIT,
      }),
      prisma.asset.count({ where }),
      prisma.asset.count({ where: { ...where, active: true } }),
      prisma.asset.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ["statusId"], where, _count: { _all: true } }),
      prisma.asset.groupBy({ by: ["conditionId"], where, _count: { _all: true } }),
      prisma.assetCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
      prisma.assetStatus.findMany({ where: { companyId }, select: { id: true, name: true } }),
      prisma.assetCondition.findMany({ where: { companyId }, select: { id: true, name: true } }),
    ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  const conditionName = new Map(conditions.map((c) => [c.id, c.name]));

  const toBreakdown = (
    raw: { _count: { _all: number } }[],
    idKey: "categoryId" | "statusId" | "conditionId",
    nameById: Map<string, string>,
  ) =>
    raw
      .map((row) => ({
        label: nameById.get((row as unknown as Record<string, string>)[idKey]) ?? "—",
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count);

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
      total,
      active: activeCount,
      inactive: total - activeCount,
      byCategory: toBreakdown(byCategoryRaw, "categoryId", categoryName),
      byStatus: toBreakdown(byStatusRaw, "statusId", statusName),
      byCondition: toBreakdown(byConditionRaw, "conditionId", conditionName),
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
  const now = new Date();

  const where: Prisma.AssetCustodyWhereInput = {
    companyId,
    ...(employeeId ? { employeeId } : {}),
    ...(assetId ? { assetId } : {}),
    ...(status ? { status } : {}),
    ...(locationId ? { holderLocationId: locationId } : {}),
    ...(deliveredAtFilter ? { deliveredAt: deliveredAtFilter } : {}),
  };
  const activeWhere: Prisma.AssetCustodyWhereInput = { ...where, status: "ACTIVE" };
  // Usa o índice composto (companyId, status, expectedReturnAt).
  const overdueWhere: Prisma.AssetCustodyWhereInput = { ...activeWhere, expectedReturnAt: { lt: now } };

  const [custodies, total, activeCount, overdueCount, byEmployeeRaw] = await Promise.all([
    prisma.assetCustody.findMany({
      where,
      include: custodyListInclude,
      orderBy: { deliveredAt: "desc" },
      take: REPORT_ROW_LIMIT,
    }),
    prisma.assetCustody.count({ where }),
    prisma.assetCustody.count({ where: activeWhere }),
    prisma.assetCustody.count({ where: overdueWhere }),
    // Top colaboradores por quantidade em posse — no banco inteiro, não só
    // nas REPORT_ROW_LIMIT linhas carregadas acima.
    prisma.assetCustody.groupBy({
      by: ["employeeId"],
      where: activeWhere,
      _sum: { quantity: true },
      _count: { _all: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 20,
    }),
  ]);

  const employees = await prisma.employee.findMany({
    where: { id: { in: byEmployeeRaw.map((row) => row.employeeId) } },
    select: { id: true, name: true },
  });
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.name]));

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

  return {
    rows,
    summary: {
      total,
      active: activeCount,
      overdue: overdueCount,
      byEmployee: byEmployeeRaw.map((row) => ({
        employeeId: row.employeeId,
        name: employeeNameById.get(row.employeeId) ?? "—",
        items: row._count._all,
        quantity: toNumber(row._sum.quantity ?? 0),
      })),
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

  // Índice composto (companyId, certificationType, status, expirationDate)
  // cobre exatamente este filtro (ver prisma/schema.prisma).
  const where: Prisma.AssetCertificationWhereInput = {
    companyId,
    certificationType: "CA",
    status: { in: ["VALID", "EXPIRED"] },
    expirationDate: { not: null, lte: horizon },
    ...(assetId ? { assetId } : {}),
    ...(categoryId ? { asset: { categoryId } } : {}),
  };

  const [certifications, total, expiredCount] = await Promise.all([
    prisma.assetCertification.findMany({
      where,
      include: {
        asset: { select: { id: true, name: true, assetCode: true, category: { select: { name: true } } } },
      },
      orderBy: { expirationDate: "asc" },
      take: REPORT_ROW_LIMIT,
    }),
    prisma.assetCertification.count({ where }),
    prisma.assetCertification.count({ where: { ...where, expirationDate: { not: null, lt: now } } }),
  ]);

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
      total,
      expired: expiredCount,
      expiringSoon: total - expiredCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Treinamentos — colaboradores inscritos, resultado e vencimento
// (Sprint SST 1.4H, fatia 3)
// ---------------------------------------------------------------------------

export type TrainingsReportFilters = {
  companyTrainingId?: string;
  employeeId?: string;
  resultStatus?: "PENDING" | "APPROVED" | "FAILED";
  dateFrom?: string;
  dateTo?: string;
};

const TRAINING_EXPIRING_SOON_WINDOW_DAYS = 30;

// Só ENROLLED entra no relatório — mesmo critério já usado por
// getTrainingExpiryAlerts (lib/alerts.ts, Sprint SST 1.4H, fatia 1): um
// CANCELLED (Sprint SST 1.4G) não representa uma inscrição real para fins
// de relatório gerencial.
export async function getTrainingsReport(companyId: string, filters: TrainingsReportFilters = {}) {
  const { companyTrainingId, employeeId, resultStatus, dateFrom, dateTo } = filters;
  const enrolledAtFilter = dateRangeFilter(dateFrom, dateTo);
  const now = new Date();
  const expiringSoonHorizon = new Date(now.getTime() + TRAINING_EXPIRING_SOON_WINDOW_DAYS * DAY_MS);

  const where: Prisma.TrainingParticipantWhereInput = {
    companyId,
    enrollmentStatus: "ENROLLED",
    ...(employeeId ? { employeeId } : {}),
    ...(resultStatus ? { resultStatus } : {}),
    ...(enrolledAtFilter ? { enrolledAt: enrolledAtFilter } : {}),
    ...(companyTrainingId ? { trainingClass: { companyTrainingId } } : {}),
  };
  const expiredWhere: Prisma.TrainingParticipantWhereInput = { ...where, expiresAt: { not: null, lt: now } };
  const expiringSoonWhere: Prisma.TrainingParticipantWhereInput = {
    ...where,
    expiresAt: { not: null, gte: now, lte: expiringSoonHorizon },
  };

  const [participants, total, expiredCount, expiringSoonCount, byResultRaw] = await Promise.all([
    prisma.trainingParticipant.findMany({
      where,
      include: {
        employee: { select: { name: true, document: true } },
        trainingClass: { select: { title: true, startsAt: true, companyTraining: { select: { title: true } } } },
      },
      orderBy: { enrolledAt: "desc" },
      take: REPORT_ROW_LIMIT,
    }),
    prisma.trainingParticipant.count({ where }),
    prisma.trainingParticipant.count({ where: expiredWhere }),
    prisma.trainingParticipant.count({ where: expiringSoonWhere }),
    prisma.trainingParticipant.groupBy({ by: ["resultStatus"], where, _count: { _all: true } }),
  ]);

  const rows = participants.map((participant) => {
    const expiresAt = participant.expiresAt;
    return {
      id: participant.id,
      employeeName: participant.employee.name,
      employeeDocument: participant.employee.document,
      trainingTitle: participant.trainingClass.companyTraining.title,
      classTitle: participant.trainingClass.title,
      classStartsAt: participant.trainingClass.startsAt.toISOString(),
      attendanceStatus: participant.attendanceStatus,
      resultStatus: participant.resultStatus,
      completedAt: participant.completedAt ? participant.completedAt.toISOString() : null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expired: Boolean(expiresAt && expiresAt.getTime() < now.getTime()),
      expiringSoon: Boolean(expiresAt && expiresAt.getTime() >= now.getTime() && expiresAt.getTime() <= expiringSoonHorizon.getTime()),
    };
  });

  return {
    rows,
    summary: {
      total,
      expired: expiredCount,
      expiringSoon: expiringSoonCount,
      byResult: byResultRaw.map((row) => ({ resultStatus: row.resultStatus, count: row._count._all })),
    },
  };
}
