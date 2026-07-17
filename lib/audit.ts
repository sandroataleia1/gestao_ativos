import type { AuditActorType, Prisma } from "@/app/generated/prisma/client";
import { getRequestContext, logInfo } from "@/lib/logger";
import { auditEventsCounter } from "@/lib/metrics";

export type { AuditActorType };

/**
 * Formato genérico de "quem fez a ação", aceito por todo service de
 * treinamento (lib/trainings.ts, lib/training-classes.ts,
 * lib/training-participants.ts). `actorType`/`providerId` são opcionais e
 * default para COMPANY_USER/undefined — todo chamador do Portal Empresa
 * continua passando só `{ id, name }` sem precisar mudar nada. O Portal
 * Consultoria SST usa `buildSstActor` (lib/sst-auth.ts) para preencher os
 * dois campos extras. `id` é sempre um `User.id` real (FK de
 * AuditLog.actorUserId) — nunca o id de SstProviderUser.
 */
export type ActorInput = {
  id: string;
  name: string;
  actorType?: AuditActorType;
  providerId?: string;
};

export type AuditAction =
  | "user.create"
  | "user.invite"
  | "user.update_profile"
  | "user.block"
  | "user.unblock"
  | "user.password_reset_link"
  | "user.delete"
  | "auth.login"
  | "auth.logout"
  | "custody.deliver"
  | "custody.return"
  | "asset.delete"
  | "employee.create"
  | "employee.update"
  // Sprint SST 1.4F.1, §10 — `employee.delete` nunca representou uma
  // exclusão real (não existe NENHUM prisma.employee.delete/deleteMany no
  // código da aplicação); mantido no catálogo só para não invalidar
  // linhas de auditoria já gravadas com esse valor (nenhuma migração de
  // dado histórico é feita). Todo código NOVO usa `employee.deactivate`.
  | "employee.delete"
  | "employee.deactivate"
  | "employee.reactivate"
  | "import.run"
  | "company.update"
  | "training.create"
  | "training.update"
  | "training.deactivate"
  | "training_class.create"
  | "training_class.update"
  | "training_class.cancel"
  | "training_participant.add"
  | "training_participant.remove"
  | "training_participant.attendance_update"
  | "training_participant.result_update"
  | "sst_provider.create"
  | "sst_provider.approve"
  | "sst_provider.suspend"
  | "sst_provider.revoke"
  | "sst_provider.reject"
  | "sst_company.pre_register"
  | "sst_company.pre_register_race_recovered"
  | "sst_company.request_access"
  | "sst_company.request_access_denied"
  | "sst_provider.claim_continue"
  | "sst_provider.claim_block"
  | "company_claim.requested"
  | "company_claim.request_reused"
  | "company_claim.concurrent_request_detected"
  | "company_claim.disputed"
  | "company_claim.approved"
  | "company_claim.rejected"
  | "company_claim.cancelled"
  | "company_claim.access_denied"
  | "company_claim.invalid_transition"
  | "platform_admin.claim_viewed"
  | "platform_admin.claim_review_started"
  | "platform_admin.claim_review_reassignment_blocked"
  | "platform_admin.claim_approved"
  | "platform_admin.claim_rejected"
  | "platform_admin.invalid_claim_transition";

/**
 * Registra uma ação administrativa/de negócio crítica. Sempre chamado
 * dentro da mesma transação da operação real (`tx`) quando há uma — se a
 * operação for revertida, o log também é, evitando um registro de
 * auditoria de algo que não aconteceu de fato. Para eventos sem transação
 * natural (login/logout), `tx` pode ser o `prisma` singleton diretamente
 * (satisfaz `Prisma.TransactionClient` estruturalmente).
 *
 * IMPORTANTE — nunca passar dado sensível em `metadata`/`targetLabel`:
 * senha, token de sessão/reset, ou documento (CPF/CNPJ) completo. Ver
 * docs/observability.md.
 */
export async function logAudit(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    actorUserId: string;
    actorName: string;
    actorType?: AuditActorType;
    providerId?: string;
    action: AuditAction;
    targetType: string;
    targetId?: string;
    targetLabel?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { requestId, correlationId } = await getRequestContext();

  await tx.auditLog.create({
    data: {
      companyId: params.companyId,
      actorUserId: params.actorUserId,
      actorName: params.actorName,
      actorType: params.actorType ?? "COMPANY_USER",
      providerId: params.providerId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      targetLabel: params.targetLabel,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
      requestId,
      correlationId,
    },
  });

  auditEventsCounter.inc({ action: params.action });
  logInfo("audit_event", {
    action: params.action,
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    targetType: params.targetType,
    targetId: params.targetId,
  });
}
