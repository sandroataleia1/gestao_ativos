import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import {
  approveCompanyClaimRequest,
  rejectCompanyClaimRequest,
  type Actor,
} from "@/lib/company-claim-request";

// Sprint SST 1.4D — camada de domínio do Portal Super Admin Lite sobre
// CompanyClaimRequest. Nunca duplica a lógica de aprovação/rejeição em si
// (isso continua só em lib/company-claim-request.ts, já testada
// extensivamente desde a Sprint SST 1.4C) — só adiciona o que é específico
// do Super Admin: iniciar análise (UNDER_REVIEW) e a auditoria
// administrativa com justificativa (nunca armazenada no
// CompanyClaimRequest em si, só no AuditLog — ver §11 do spec: a
// justificativa no AuditLog é suficiente para este MVP, sem precisar de
// coluna nova).

const ACTIVE_CLAIM_STATUSES = ["PENDING", "UNDER_REVIEW"] as const;

export type StartReviewResult = {
  claimId: string;
  companyId: string;
  status: string;
};

/**
 * PENDING -> UNDER_REVIEW. Idempotente para o MESMO revisor (chamar de novo
 * sobre uma claim já UNDER_REVIEW por ele mesmo é um no-op de sucesso).
 *
 * Sprint SST 1.4D.1, §9 — endurecido: uma claim já UNDER_REVIEW por OUTRO
 * Super Admin ativo NUNCA é tomada silenciosamente por esta chamada (nem
 * mesmo com auditoria por trás, como na versão anterior) — sempre rejeita
 * com ConflictError e audita a tentativa. Não existe hoje necessidade
 * operacional que justifique uma reatribuição automática (nenhum volume
 * real de reivindicações concorrentes em produção) — por decisão explícita
 * do spec desta sprint ("bloquear e deixar a funcionalidade para uma
 * evolução futura"), a reatribuição explícita (ação dedicada, com
 * confirmação e justificativa) fica para uma sprint futura. Nunca cria
 * membership, nunca atribui ADMIN, nunca altera vínculo SST, nunca altera
 * Company para CLAIMED.
 *
 * Reaproveita `reviewedByUserId`/`reviewedAt` (já existentes no schema
 * desde a Sprint SST 1.4C) também para "quem está revisando agora" — nunca
 * precisou de uma coluna nova (`assignedReviewerUserId`): a decisão final
 * (approve/reject) sempre sobrescreve os dois com o valor definitivo de
 * qualquer forma, então reusar os campos não perde nenhuma informação.
 */
export async function startCompanyClaimReview(params: {
  claimRequestId: string;
  reviewer: Actor;
  reviewNote?: string;
}): Promise<StartReviewResult> {
  const { claimRequestId, reviewer, reviewNote } = params;

  const existing = await prisma.companyClaimRequest.findUnique({ where: { id: claimRequestId } });
  if (!existing) throw new NotFoundError("Solicitação de reivindicação não encontrada.");

  if (existing.status === "UNDER_REVIEW" && existing.reviewedByUserId === reviewer.id) {
    return { claimId: existing.id, companyId: existing.companyId, status: existing.status };
  }

  if (!ACTIVE_CLAIM_STATUSES.includes(existing.status as (typeof ACTIVE_CLAIM_STATUSES)[number])) {
    await logAudit(prisma, {
      companyId: existing.companyId,
      actorUserId: reviewer.id,
      actorName: reviewer.name,
      action: "platform_admin.invalid_claim_transition",
      targetType: "CompanyClaimRequest",
      targetId: claimRequestId,
      metadata: { attemptedAction: "start_review", fromStatus: existing.status },
    }).catch(() => {});
    throw new ConflictError("Esta solicitação não pode ser colocada em análise no estado atual.");
  }

  if (existing.status === "UNDER_REVIEW" && existing.reviewedByUserId && existing.reviewedByUserId !== reviewer.id) {
    // Já em análise por OUTRO Super Admin — nunca sobrescreve
    // silenciosamente (§9). Audita a tentativa (companyId natural aqui,
    // então AuditLog é suficiente — não precisa de PlatformAuditLog).
    await logAudit(prisma, {
      companyId: existing.companyId,
      actorUserId: reviewer.id,
      actorName: reviewer.name,
      action: "platform_admin.claim_review_reassignment_blocked",
      targetType: "CompanyClaimRequest",
      targetId: claimRequestId,
      metadata: { previousReviewerUserId: existing.reviewedByUserId },
    }).catch(() => {});
    throw new ConflictError(
      "Esta solicitação já está em análise por outro Super Admin. Reatribuição explícita não está disponível nesta versão.",
    );
  }

  // Guarda contra corrida (dois Super Admin iniciando análise ao mesmo
  // tempo, ambos partindo de PENDING) — mesmo padrão updateMany+contagem já
  // usado em todo o serviço de claim: só a primeira a commitar de fato
  // aplica.
  const { count } = await prisma.companyClaimRequest.updateMany({
    where: { id: claimRequestId, status: existing.status },
    data: { status: "UNDER_REVIEW", reviewedByUserId: reviewer.id, reviewedAt: new Date() },
  });
  if (count === 0) {
    // A outra transação venceu a corrida — não é um erro do ponto de vista
    // técnico (a claim está em análise de qualquer forma), mas também não
    // foi ESTE revisor quem conseguiu (spec §23: "segunda resposta sem erro
    // técnico"). Devolve o estado atual sem lançar.
    const raced = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claimRequestId } });
    return { claimId: raced.id, companyId: raced.companyId, status: raced.status };
  }

  await logAudit(prisma, {
    companyId: existing.companyId,
    actorUserId: reviewer.id,
    actorName: reviewer.name,
    action: "platform_admin.claim_review_started",
    targetType: "CompanyClaimRequest",
    targetId: claimRequestId,
    metadata: {
      ...(reviewNote ? { reviewNote } : {}),
    },
  });

  return { claimId: claimRequestId, companyId: existing.companyId, status: "UNDER_REVIEW" };
}

/**
 * Registra que um Super Admin visualizou o detalhe de uma claim —
 * deduplicado (nunca gera um evento por render/refresh): só grava um novo
 * `platform_admin.claim_viewed` se o último, do MESMO ator para a MESMA
 * claim, tiver mais de 5 minutos (ou não existir).
 */
export async function recordClaimViewed(params: { claimRequestId: string; companyId: string; viewer: Actor }): Promise<void> {
  const { claimRequestId, companyId, viewer } = params;
  const DEDUPE_WINDOW_MS = 5 * 60_000;

  const lastView = await prisma.auditLog.findFirst({
    where: { action: "platform_admin.claim_viewed", targetId: claimRequestId, actorUserId: viewer.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastView && Date.now() - lastView.createdAt.getTime() < DEDUPE_WINDOW_MS) {
    return;
  }

  await logAudit(prisma, {
    companyId,
    actorUserId: viewer.id,
    actorName: viewer.name,
    action: "platform_admin.claim_viewed",
    targetType: "CompanyClaimRequest",
    targetId: claimRequestId,
    metadata: {},
  }).catch(() => {});
}

export type PlatformAdminDecisionResult = {
  claimId: string;
  companyId: string;
  controlStatus?: string;
  membershipId?: string;
};

/**
 * Aprova via o serviço de domínio já existente (nunca duplica a lógica) —
 * só adiciona a auditoria administrativa (`platform_admin.claim_approved`,
 * com a justificativa) por cima. Se `approveCompanyClaimRequest` falhar
 * (claim já decidida, corrida perdida, etc.), o erro já vem com a
 * classificação correta (ConflictError/NotFoundError/ValidationError) —
 * este wrapper não intercepta nem reclassifica.
 */
export async function approveCompanyClaimRequestAsPlatformAdmin(params: {
  claimRequestId: string;
  reviewer: Actor;
  reviewNote: string;
  verificationMethod?: string;
}): Promise<PlatformAdminDecisionResult> {
  const { claimRequestId, reviewer, reviewNote, verificationMethod } = params;

  const result = await approveCompanyClaimRequest({ claimRequestId, reviewer });

  await logAudit(prisma, {
    companyId: result.companyId,
    actorUserId: reviewer.id,
    actorName: reviewer.name,
    action: "platform_admin.claim_approved",
    targetType: "CompanyClaimRequest",
    targetId: claimRequestId,
    metadata: { reviewNote, ...(verificationMethod ? { verificationMethod } : {}), finalControlStatus: result.controlStatus },
  }).catch(() => {});

  return { claimId: result.claimId, companyId: result.companyId, controlStatus: result.controlStatus, membershipId: result.membershipId };
}

export async function rejectCompanyClaimRequestAsPlatformAdmin(params: {
  claimRequestId: string;
  reviewer: Actor;
  reviewNote: string;
  verificationMethod?: string;
}): Promise<PlatformAdminDecisionResult> {
  const { claimRequestId, reviewer, reviewNote, verificationMethod } = params;

  // rejectCompanyClaimRequest já aceita `reason` — usamos a MESMA
  // justificativa ali (rejectionReason, campo já existente no claim) e
  // aqui de novo no AuditLog administrativo (com verificationMethod, que o
  // claim em si não guarda).
  const result = await rejectCompanyClaimRequest({ claimRequestId, reviewer, reason: reviewNote });

  await logAudit(prisma, {
    companyId: result.companyId,
    actorUserId: reviewer.id,
    actorName: reviewer.name,
    action: "platform_admin.claim_rejected",
    targetType: "CompanyClaimRequest",
    targetId: claimRequestId,
    metadata: { reviewNote, ...(verificationMethod ? { verificationMethod } : {}) },
  }).catch(() => {});

  return { claimId: result.claimId, companyId: result.companyId };
}
