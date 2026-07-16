import { prisma } from "@/lib/prisma";
import type { PlatformAuditSeverity } from "@/app/generated/prisma/client";

// Sprint SST 1.4D.1, §12 — leitura para /platform-admin/audit. Página
// simples, SOMENTE LEITURA (nenhuma rota de edição/exclusão neste módulo
// nem em nenhum outro — PlatformAuditLog é append-only no código da
// aplicação). Nunca expõe metadata bruta sem sanitização, nunca exibe
// CNPJ/token/cookie/dados operacionais.

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** Resumo humano de uma linha — nunca a metadata bruta (que pode conter
 * chaves não previstas por quem grava). Só os campos já sanitizados pelo
 * próprio schema (action/severity/source/reason) mais um resumo curto do
 * metadata, nunca serializado por inteiro. */
function summarize(action: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const obj = metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (action === "platform_admin.exposure_diagnostic_executed" && typeof obj.since === "string" && typeof obj.until === "string") {
    parts.push(`janela: ${obj.since} → ${obj.until}`);
  }
  if (typeof obj.created === "boolean") parts.push(obj.created ? "criado" : "já existente");
  if (typeof obj.extraordinary === "boolean" && obj.extraordinary) parts.push("extraordinário (sem outro admin ativo)");
  return parts.join("; ");
}

export type PlatformAuditListFilter = {
  action?: string;
  severity?: PlatformAuditSeverity | "ALL";
  since?: Date;
  until?: Date;
  page?: number;
  pageSize?: number;
};

export type PlatformAuditListItem = {
  id: string;
  action: string;
  severity: PlatformAuditSeverity;
  source: string;
  actorEmailMasked: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  reason: string | null;
  summary: string;
  createdAt: Date;
};

export type PlatformAuditListResult = {
  items: PlatformAuditListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 25;

export async function listPlatformAuditLogs(params: PlatformAuditListFilter): Promise<PlatformAuditListResult> {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);

  const where = {
    ...(params.action ? { action: params.action } : {}),
    ...(params.severity && params.severity !== "ALL" ? { severity: params.severity } : {}),
    ...(params.since || params.until
      ? {
          createdAt: {
            ...(params.since ? { gte: params.since } : {}),
            ...(params.until ? { lte: params.until } : {}),
          },
        }
      : {}),
  };

  const [totalCount, rows] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        severity: true,
        source: true,
        targetType: true,
        targetId: true,
        requestId: true,
        reason: true,
        metadata: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items: PlatformAuditListItem[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    severity: row.severity,
    source: row.source,
    actorEmailMasked: row.actor ? maskEmail(row.actor.email) : null,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    reason: row.reason,
    summary: summarize(row.action, row.metadata),
    createdAt: row.createdAt,
  }));

  return { items, totalCount, page, pageSize };
}

export async function listDistinctPlatformAuditActions(): Promise<string[]> {
  const rows = await prisma.platformAuditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}
