import type { Prisma, PlatformAuditSeverity, PlatformAuditSource } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getRequestContext, logInfo } from "@/lib/logger";

// Sprint SST 1.4D.1, §4-6 — auditoria persistente das ações GLOBAIS da
// plataforma (Portal Super Admin Lite), que `lib/audit.ts` (AuditLog) não
// consegue representar corretamente porque `AuditLog.companyId` é
// obrigatório. Este módulo é o único ponto que grava em `PlatformAuditLog` —
// nunca duplicar a montagem do payload em cada rota/script.
//
// Escopo deliberado: só as ações verdadeiramente SEM Company natural
// (bootstrap/concessão/revogação de Super Admin, tentativa de acesso não
// autorizado ao Portal, execução do diagnóstico de exposição). Decisões
// administrativas sobre UMA CompanyClaimRequest específica (visualização,
// início de análise, aprovação, rejeição, transição inválida) já são
// persistidas desde a Sprint SST 1.4D em `AuditLog`, corretamente escopadas
// pelo `companyId` da empresa reivindicada, e já cobertas por testes — não
// são migradas para cá (evita duas fontes de verdade para o mesmo evento).
//
// Nunca representa autorização operacional (isso continua sendo só
// `PlatformUser.active`); nunca cria CompanyMembership; nunca altera
// `User.companyId`. Append-only no código da aplicação: nenhuma rota deste
// projeto faz UPDATE/DELETE em PlatformAuditLog.

export type PlatformAuditAction =
  | "platform_admin.first_bootstrap"
  | "platform_admin.access_granted"
  | "platform_admin.access_reactivated"
  | "platform_admin.access_revoked"
  | "platform_admin.last_admin_revocation_blocked"
  | "platform_admin.unauthorized_access_attempt"
  | "platform_admin.exposure_diagnostic_executed"
  // Cadastro público de consultoria (app/sst/register) — mesmo raciocínio
  // do resto deste módulo: uma SstProvider recém-criada por autocadastro
  // ainda não tem nenhum vínculo com Company nenhuma, então não existe
  // `companyId` para gravar em `AuditLog` (obrigatório lá). Distinto de
  // "sst_provider.create" (lib/audit.ts), que é sempre iniciado por uma
  // empresa autorizando um prestador que ainda não existia.
  | "sst_provider.self_registered";

export type PlatformAuditSeverityInput = PlatformAuditSeverity;
export type PlatformAuditSourceInput = PlatformAuditSource;

export type LogPlatformAuditParams = {
  action: PlatformAuditAction;
  severity: PlatformAuditSeverityInput;
  source: PlatformAuditSourceInput;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

// Heurística best-effort (mesmo espírito de `reviewNoteSchema` em
// lib/validations/platform-admin.ts) — nunca uma garantia de segurança real,
// só uma rede de segurança contra o erro óbvio de alguém passar um segredo
// no `metadata`/`reason` por engano. Verifica tanto as CHAVES quanto os
// VALORES (string) do objeto, recursivamente.
const FORBIDDEN_KEY_PATTERN = /senha|password|token|cookie|sess(a|ã)o|secret/i;
const FORBIDDEN_VALUE_PATTERN = /(senha|password|token|secret)\s*[:=]/i;

export function assertNoSecrets(value: unknown, path = ""): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE_PATTERN.test(value)) {
      throw new Error(`logPlatformAudit: valor em "${path || "reason"}" parece conter um segredo (senha/token) — nunca persistir isso.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecrets(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        throw new Error(`logPlatformAudit: chave "${path}${path ? "." : ""}${key}" parece um segredo — nunca persistir isso em metadata.`);
      }
      assertNoSecrets(item, `${path}${path ? "." : ""}${key}`);
    }
  }
}

/**
 * Grava um evento de auditoria GLOBAL da plataforma. `tx` opcional — quando
 * a ação tem uma alteração de estado transacional (ex.: concessão de
 * PlatformUser), passar o mesmo `Prisma.TransactionClient` garante que o
 * registro de auditoria só persiste se a transação inteira for commitada
 * (nunca um "concedido" persistente para uma concessão revertida). Scripts
 * standalone (CLI) e tentativas negadas fora de transação usam o `prisma`
 * singleton (default).
 */
export async function logPlatformAudit(
  params: LogPlatformAuditParams,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  assertNoSecrets(params.reason ?? null, "reason");
  assertNoSecrets(params.metadata ?? null);

  const requestContext = await getRequestContext();
  const requestId = params.requestId ?? requestContext.requestId;

  await tx.platformAuditLog.create({
    data: {
      action: params.action,
      severity: params.severity,
      source: params.source,
      actorUserId: params.actorUserId ?? null,
      targetType: params.targetType,
      targetId: params.targetId,
      requestId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      reason: params.reason,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  logInfo("platform_audit_event", {
    action: params.action,
    severity: params.severity,
    source: params.source,
    actorUserId: params.actorUserId,
    targetType: params.targetType,
    targetId: params.targetId,
  });
}
