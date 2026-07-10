import { prisma } from "@/lib/prisma";
import { getExpiringCaReport } from "@/lib/reports";
import { toNumber } from "@/lib/stock";
import { formatDateOnlyBR } from "@/lib/date-only";

// Central de alertas — MVP calculado sob demanda (sem fila/BullMQ, sem
// e-mail): cada chamada a `getAlerts` recalcula tudo na hora, a partir dos
// mesmos dados já usados em /reports e /custodies. Nada é persistido; não
// existe tabela de alertas.

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AlertType = "CA_EXPIRED" | "CA_EXPIRING_SOON" | "CUSTODY_OVERDUE" | "LOW_STOCK";
export type AlertResourceType = "ASSET" | "CUSTODY";

export type Alert = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  resourceType: AlertResourceType;
  resourceId: string;
  detectedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTODY_OVERDUE_CRITICAL_DAYS = 7;
const CA_EXPIRING_SOON_WINDOW_DAYS = 30;

// Requisito: CA vencido = CRITICAL; CA vence em até 30 dias = WARNING.
// Reaproveita getExpiringCaReport (lib/reports.ts) — mesma consulta, só
// remapeada para o formato de alerta.
export async function getCaAlerts(companyId: string, now: Date): Promise<Alert[]> {
  const { rows } = await getExpiringCaReport(companyId, { withinDays: CA_EXPIRING_SOON_WINDOW_DAYS });

  return rows.map((row) => {
    const isExpired = row.bucket === "EXPIRED";
    return {
      id: `ca-${row.id}`,
      type: isExpired ? ("CA_EXPIRED" as const) : ("CA_EXPIRING_SOON" as const),
      severity: isExpired ? ("CRITICAL" as const) : ("WARNING" as const),
      title: isExpired
        ? `CA vencido: ${row.assetName}`
        : `CA vence em ${row.daysUntilExpiration} dia(s): ${row.assetName}`,
      description: `Certificado ${row.certificationNumber}${
        row.issuer ? ` (${row.issuer})` : ""
      } — validade ${formatDateOnlyBR(row.expirationDate)}.`,
      resourceType: "ASSET" as const,
      resourceId: row.assetId,
      detectedAt: now.toISOString(),
    };
  });
}

// Requisito: custódia atrasada = WARNING, ou CRITICAL se atrasada há mais
// de 7 dias. "Atrasada" usa o mesmo critério derivado de
// lib/custodies/badge.ts (nunca persistido).
export async function getCustodyOverdueAlerts(companyId: string, now: Date): Promise<Alert[]> {
  // O `where` já garante exatamente o critério de `isCustodyOverdue`
  // (status ACTIVE + expectedReturnAt no passado) usando o mesmo `now` —
  // reaplicar o filtro em JS depois era redundante. Usa o índice composto
  // (companyId, status, expectedReturnAt).
  const custodies = await prisma.assetCustody.findMany({
    where: { companyId, status: "ACTIVE", expectedReturnAt: { lt: now } },
    include: {
      employee: { select: { name: true } },
      asset: { select: { name: true } },
    },
    orderBy: { expectedReturnAt: "asc" },
    take: 500,
  });

  return custodies.map((custody) => {
    const daysLate = Math.floor((now.getTime() - custody.expectedReturnAt!.getTime()) / DAY_MS);
    const severity: AlertSeverity = daysLate > CUSTODY_OVERDUE_CRITICAL_DAYS ? "CRITICAL" : "WARNING";
    return {
      id: `custody-${custody.id}`,
      type: "CUSTODY_OVERDUE" as const,
      severity,
      title: `Devolução atrasada: ${custody.employee.name} — ${custody.asset.name}`,
      description: `Prevista para ${formatDateOnlyBR(custody.expectedReturnAt)}, atrasada há ${daysLate} dia(s).`,
      resourceType: "CUSTODY" as const,
      resourceId: custody.id,
      detectedAt: now.toISOString(),
    };
  });
}

// Requisito: estoque abaixo do mínimo, se houver campo mínimo — o schema já
// tem `Asset.minimumStock` (usado só por consumíveis; ver
// app/(app)/assets/asset-form-dialog.tsx). Assets sem `minimumStock`
// configurado nunca geram alerta (não há "mínimo padrão" inventado). Saldo
// zerado é CRITICAL; abaixo do mínimo mas ainda positivo é WARNING.
export async function getLowStockAlerts(companyId: string, now: Date): Promise<Alert[]> {
  const assetsWithMinimum = await prisma.asset.findMany({
    where: { companyId, active: true, trackingMode: "CONSUMABLE", minimumStock: { not: null } },
    select: { id: true, name: true, defaultUnit: true, minimumStock: true },
  });
  if (assetsWithMinimum.length === 0) return [];

  // `minimumStock` só existe pra ativos CONSUMABLE, que são sempre saldo em
  // StockBalance (nunca AssetUnit) — soma direto por groupBy em vez de
  // carregar `getStockRows` inteiro (que também traz unidades INDIVIDUAL,
  // irrelevantes aqui) só pra somar em memória.
  const balances = await prisma.stockBalance.groupBy({
    by: ["assetId"],
    where: { companyId, assetId: { in: assetsWithMinimum.map((asset) => asset.id) } },
    _sum: { quantity: true },
  });
  const totalByAsset = new Map(balances.map((row) => [row.assetId, toNumber(row._sum.quantity ?? 0)]));

  const alerts: Alert[] = [];
  for (const asset of assetsWithMinimum) {
    const minimum = toNumber(asset.minimumStock);
    const total = totalByAsset.get(asset.id) ?? 0;
    if (total >= minimum) continue;

    const unit = asset.defaultUnit ? ` ${asset.defaultUnit}` : "";
    alerts.push({
      id: `stock-${asset.id}`,
      type: "LOW_STOCK",
      severity: total <= 0 ? "CRITICAL" : "WARNING",
      title: `Estoque baixo: ${asset.name}`,
      description: `Saldo atual: ${total}${unit} — mínimo configurado: ${minimum}${unit}.`,
      resourceType: "ASSET",
      resourceId: asset.id,
      detectedAt: now.toISOString(),
    });
  }
  return alerts;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export type AlertFilters = {
  severity?: AlertSeverity;
  type?: AlertType;
};

export async function getAlerts(companyId: string, filters: AlertFilters = {}) {
  const now = new Date();
  const [caAlerts, custodyAlerts, stockAlerts] = await Promise.all([
    getCaAlerts(companyId, now),
    getCustodyOverdueAlerts(companyId, now),
    getLowStockAlerts(companyId, now),
  ]);

  const allAlerts = [...caAlerts, ...custodyAlerts, ...stockAlerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  // O resumo sempre reflete o total real de alertas, independentemente do
  // filtro aplicado — só a lista de linhas retornada é filtrada.
  const summary = {
    total: allAlerts.length,
    critical: allAlerts.filter((alert) => alert.severity === "CRITICAL").length,
    warning: allAlerts.filter((alert) => alert.severity === "WARNING").length,
    info: allAlerts.filter((alert) => alert.severity === "INFO").length,
  };

  let alerts = allAlerts;
  if (filters.severity) alerts = alerts.filter((alert) => alert.severity === filters.severity);
  if (filters.type) alerts = alerts.filter((alert) => alert.type === filters.type);

  return { alerts, summary };
}
