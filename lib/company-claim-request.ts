import type { Prisma, CompanyClaimRequestOrigin, CompanyControlStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { SYSTEM_ROLES } from "@/lib/permissions";

// Sprint SST 1.4C — serviço de domínio da entidade CompanyClaimRequest.
// Contenção da vulnerabilidade em que só conhecer um CNPJ válido já
// concedia CompanyMembership ACTIVE + papel ADMIN, sem nenhuma comprovação
// de representação legal (ver app/api/register/route.ts, commit anterior
// desta sprint). Regra central e permanente: NENHUMA função aqui concede
// acesso por si só — só `approveCompanyClaimRequest` cria
// CompanyMembership, e só depois de validações explícitas nesta mesma
// transação. Nenhum campo de aprovação (status, reviewedByUserId,
// roleId) é aceito do chamador — sempre derivado no servidor.

export type Actor = { id: string; name: string };

async function lockCompanyRow(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  // Mesma lição da Sprint SST 1.4B (lib/company-claim.ts): travar a linha da
  // Company SEMPRE no início da transação, antes de qualquer INSERT com FK
  // para Company (logAudit, CompanyClaimRequest, CompanyMembership) — essas
  // inserções tomam um lock FOR KEY SHARE na linha referenciada; pedir FOR
  // UPDATE só depois abre uma janela real de deadlock entre duas transações
  // concorrentes na mesma empresa.
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
}

const ACTIVE_CLAIM_STATUSES = ["PENDING", "UNDER_REVIEW"] as const;

export type CreateOrReuseClaimRequestInput = {
  companyId: string;
  requester: Actor;
  origin: CompanyClaimRequestOrigin;
};

export type CreateOrReuseClaimRequestResult = {
  claim: { id: string; companyId: string; requesterUserId: string; status: string };
  reused: boolean;
};

/**
 * Cria (ou reabre) a solicitação de reivindicação de UM usuário para UMA
 * Company — nunca cria uma segunda linha para o mesmo par
 * (`@@unique([companyId, requesterUserId])` é a fonte final de verdade).
 * Nunca cria CompanyMembership. Se outro usuário já tiver uma solicitação
 * ativa (PENDING/UNDER_REVIEW) para a mesma empresa, marca
 * `Company.controlStatus: DISPUTED` (§7) — decisão explícita: a plataforma
 * nunca escolhe sozinha qual solicitante é o legítimo.
 */
export async function createOrReuseClaimRequest(
  input: CreateOrReuseClaimRequestInput,
): Promise<CreateOrReuseClaimRequestResult> {
  const { companyId, requester, origin } = input;

  return prisma.$transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);

    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { controlStatus: true },
    });
    // Defesa em profundidade — o chamador (app/api/register/route.ts) já
    // filtra CLAIMED antes de chegar aqui; nunca confia só nisso.
    if (company.controlStatus === "CLAIMED") {
      throw new ConflictError("Esta empresa já possui um cadastro administrado na plataforma.");
    }

    const existing = await tx.companyClaimRequest.findUnique({
      where: { companyId_requesterUserId: { companyId, requesterUserId: requester.id } },
    });

    let claim: { id: string; companyId: string; requesterUserId: string; status: string };
    let reused: boolean;

    if (!existing) {
      claim = await tx.companyClaimRequest.create({
        data: { companyId, requesterUserId: requester.id, origin, status: "PENDING" },
      });
      reused = false;
      await logAudit(tx, {
        companyId,
        actorUserId: requester.id,
        actorName: requester.name,
        action: "company_claim.requested",
        targetType: "CompanyClaimRequest",
        targetId: claim.id,
        metadata: { origin },
      });
    } else if (ACTIVE_CLAIM_STATUSES.includes(existing.status as (typeof ACTIVE_CLAIM_STATUSES)[number])) {
      // Mesmo usuário, mesma empresa, tentativa repetida — idempotente,
      // nunca cria uma segunda linha nem duplica o pedido.
      claim = existing;
      reused = true;
      await logAudit(tx, {
        companyId,
        actorUserId: requester.id,
        actorName: requester.name,
        action: "company_claim.request_reused",
        targetType: "CompanyClaimRequest",
        targetId: claim.id,
        metadata: { status: existing.status },
      });
    } else if (existing.status === "APPROVED") {
      // Não deveria ser alcançável em uso normal (uma vez APPROVED, o
      // usuário já tem CompanyMembership e o register route nem chamaria
      // esta função) — devolve como está, nunca reabre uma aprovação.
      claim = existing;
      reused = true;
    } else {
      // REJECTED | CANCELLED | EXPIRED — reabre a MESMA linha (nunca cria
      // outra), preservando `createdAt` original como histórico.
      claim = await tx.companyClaimRequest.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          origin,
          requestedAt: new Date(),
          reviewedAt: null,
          reviewedByUserId: null,
          rejectionReason: null,
        },
      });
      reused = true;
      await logAudit(tx, {
        companyId,
        actorUserId: requester.id,
        actorName: requester.name,
        action: "company_claim.request_reused",
        targetType: "CompanyClaimRequest",
        targetId: claim.id,
        metadata: { previousStatus: existing.status, reopened: true },
      });
    }

    // §7 — outro solicitante ATIVO e diferente para a mesma empresa vira
    // disputa; a plataforma nunca decide sozinha quem é o legítimo.
    const otherActiveRequesters = await tx.companyClaimRequest.count({
      where: {
        companyId,
        requesterUserId: { not: requester.id },
        status: { in: [...ACTIVE_CLAIM_STATUSES] },
      },
    });

    if (otherActiveRequesters > 0) {
      if (company.controlStatus !== "DISPUTED") {
        await tx.company.update({ where: { id: companyId }, data: { controlStatus: "DISPUTED" } });
        await logAudit(tx, {
          companyId,
          actorUserId: requester.id,
          actorName: requester.name,
          action: "company_claim.disputed",
          targetType: "Company",
          targetId: companyId,
          metadata: { activeRequesters: otherActiveRequesters + 1 },
        });
      } else {
        await logAudit(tx, {
          companyId,
          actorUserId: requester.id,
          actorName: requester.name,
          action: "company_claim.concurrent_request_detected",
          targetType: "Company",
          targetId: companyId,
          metadata: { activeRequesters: otherActiveRequesters + 1 },
        });
      }
    } else if (company.controlStatus === "UNCLAIMED") {
      await tx.company.update({ where: { id: companyId }, data: { controlStatus: "CLAIM_PENDING" } });
    }

    return { claim, reused };
  });
}

async function maybeRevertToUnclaimed(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  const remainingActive = await tx.companyClaimRequest.count({
    where: { companyId, status: { in: [...ACTIVE_CLAIM_STATUSES] } },
  });
  if (remainingActive > 0) return;

  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { controlStatus: true } });
  // §14 — só volta a UNCLAIMED se não houver NENHUMA outra disputa/solicitação
  // ativa; nunca mexe numa Company já CLAIMED.
  if (company.controlStatus === "CLAIM_PENDING" || company.controlStatus === "DISPUTED") {
    await tx.company.update({ where: { id: companyId }, data: { controlStatus: "UNCLAIMED" } });
  }
}

export type ApproveClaimRequestResult = {
  claimId: string;
  companyId: string;
  controlStatus: CompanyControlStatus;
  membershipId: string;
};

/**
 * Aprova uma CompanyClaimRequest — único ponto do sistema que cria
 * CompanyMembership a partir de uma reivindicação. SEM endpoint público
 * nesta sprint (§13): preparado para ser chamado por um futuro Super Admin
 * Lite. Nunca aceita `companyId`/`requesterUserId`/`roleId`/status final
 * arbitrário do chamador — todos derivados da própria CompanyClaimRequest
 * já persistida.
 */
export async function approveCompanyClaimRequest(params: {
  claimRequestId: string;
  reviewer: Actor;
}): Promise<ApproveClaimRequestResult> {
  const { claimRequestId, reviewer } = params;

  const preCheck = await prisma.companyClaimRequest.findUnique({ where: { id: claimRequestId } });
  if (!preCheck) throw new NotFoundError("Solicitação de reivindicação não encontrada.");
  if (!ACTIVE_CLAIM_STATUSES.includes(preCheck.status as (typeof ACTIVE_CLAIM_STATUSES)[number])) {
    throw new ConflictError("Esta solicitação já foi revisada.");
  }

  return prisma.$transaction(async (tx) => {
    await lockCompanyRow(tx, preCheck.companyId);

    const company = await tx.company.findUniqueOrThrow({ where: { id: preCheck.companyId } });
    if (company.controlStatus === "CLAIMED") {
      throw new ConflictError("Esta empresa já possui um administrador.");
    }

    const existingMembership = await tx.companyMembership.findFirst({
      where: { userId: preCheck.requesterUserId, companyId: preCheck.companyId },
    });
    if (existingMembership) {
      throw new ConflictError("Este usuário já possui vínculo com esta empresa.");
    }

    const adminRole = await tx.role.findFirst({
      where: { companyId: preCheck.companyId, name: SYSTEM_ROLES.ADMIN },
    });
    if (!adminRole) {
      throw new ValidationError("Papéis padrão desta empresa ainda não foram provisionados.");
    }

    // Guarda contra aprovação concorrente sobre a MESMA solicitação — só a
    // primeira a commitar de fato aplica (mesmo padrão da Sprint 1.4B).
    const { count } = await tx.companyClaimRequest.updateMany({
      where: { id: claimRequestId, status: preCheck.status },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedByUserId: reviewer.id },
    });
    if (count === 0) {
      throw new ConflictError("Esta solicitação já foi revisada por outra requisição.");
    }

    await tx.userRole.create({
      data: { userId: preCheck.requesterUserId, companyId: preCheck.companyId, roleId: adminRole.id },
    });
    const membership = await tx.companyMembership.create({
      data: { userId: preCheck.requesterUserId, companyId: preCheck.companyId, status: "ACTIVE", activatedAt: new Date() },
    });

    // Invalida outras solicitações concorrentes ativas para a mesma empresa
    // (§13 item 12) — nunca ficam esquecidas como PENDING órfão depois que
    // outra pessoa já foi aprovada como administradora.
    const others = await tx.companyClaimRequest.findMany({
      where: { companyId: preCheck.companyId, id: { not: claimRequestId }, status: { in: [...ACTIVE_CLAIM_STATUSES] } },
    });
    for (const other of others) {
      await tx.companyClaimRequest.update({
        where: { id: other.id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedByUserId: reviewer.id,
          rejectionReason: "Outra solicitação foi aprovada para esta empresa.",
        },
      });
      await logAudit(tx, {
        companyId: preCheck.companyId,
        actorUserId: reviewer.id,
        actorName: reviewer.name,
        action: "company_claim.rejected",
        targetType: "CompanyClaimRequest",
        targetId: other.id,
        metadata: { reason: "SUPERSEDED_BY_APPROVAL" },
      });
    }

    // Mesma regra de sempre (Sprint Comercial SST 1.4, §16): só finaliza
    // CLAIMED se não sobrar vínculo SST provisório sem revisão.
    const unresolvedProvisionalLinks = await tx.sstProviderCompany.count({
      where: { companyId: preCheck.companyId, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE", companyReviewedAt: null },
    });
    const finalControlStatus: CompanyControlStatus = unresolvedProvisionalLinks > 0 ? "CLAIM_PENDING" : "CLAIMED";
    await tx.company.update({
      where: { id: preCheck.companyId },
      data:
        finalControlStatus === "CLAIMED"
          ? { controlStatus: "CLAIMED", claimedAt: new Date() }
          : { controlStatus: "CLAIM_PENDING" },
    });

    await logAudit(tx, {
      companyId: preCheck.companyId,
      actorUserId: reviewer.id,
      actorName: reviewer.name,
      action: "company_claim.approved",
      targetType: "CompanyClaimRequest",
      targetId: claimRequestId,
      metadata: { requesterUserId: preCheck.requesterUserId, finalControlStatus },
    });

    return {
      claimId: claimRequestId,
      companyId: preCheck.companyId,
      controlStatus: finalControlStatus,
      membershipId: membership.id,
    };
  });
}

export type RejectClaimRequestResult = { claimId: string; companyId: string };

/** Decisão administrativa (futuro Super Admin Lite) — nunca apaga a
 * solicitação, nunca concede acesso, preserva histórico. */
export async function rejectCompanyClaimRequest(params: {
  claimRequestId: string;
  reviewer: Actor;
  reason?: string;
}): Promise<RejectClaimRequestResult> {
  const { claimRequestId, reviewer, reason } = params;
  const existing = await prisma.companyClaimRequest.findUnique({ where: { id: claimRequestId } });
  if (!existing) throw new NotFoundError("Solicitação de reivindicação não encontrada.");

  return prisma.$transaction(async (tx) => {
    await lockCompanyRow(tx, existing.companyId);

    const { count } = await tx.companyClaimRequest.updateMany({
      where: { id: claimRequestId, status: { in: [...ACTIVE_CLAIM_STATUSES] } },
      data: { status: "REJECTED", reviewedAt: new Date(), reviewedByUserId: reviewer.id, rejectionReason: reason ?? null },
    });
    if (count === 0) throw new ConflictError("Esta solicitação já foi revisada.");

    await logAudit(tx, {
      companyId: existing.companyId,
      actorUserId: reviewer.id,
      actorName: reviewer.name,
      action: "company_claim.rejected",
      targetType: "CompanyClaimRequest",
      targetId: claimRequestId,
      metadata: { requesterUserId: existing.requesterUserId },
    });

    await maybeRevertToUnclaimed(tx, existing.companyId);
    return { claimId: claimRequestId, companyId: existing.companyId };
  });
}

export type CancelClaimRequestResult = { claimId: string; companyId: string };

/** Cancelamento pelo próprio requerente — nunca concede acesso, sempre
 * ownership-checked (nunca cancela a solicitação de outro usuário). */
export async function cancelCompanyClaimRequest(params: {
  claimRequestId: string;
  actor: Actor;
}): Promise<CancelClaimRequestResult> {
  const { claimRequestId, actor } = params;
  const existing = await prisma.companyClaimRequest.findFirst({
    where: { id: claimRequestId, requesterUserId: actor.id },
  });
  if (!existing) throw new NotFoundError("Solicitação de reivindicação não encontrada.");

  return prisma.$transaction(async (tx) => {
    await lockCompanyRow(tx, existing.companyId);

    const { count } = await tx.companyClaimRequest.updateMany({
      where: { id: claimRequestId, requesterUserId: actor.id, status: { in: [...ACTIVE_CLAIM_STATUSES] } },
      data: { status: "CANCELLED" },
    });
    if (count === 0) throw new ConflictError("Esta solicitação já foi revisada ou cancelada.");

    await logAudit(tx, {
      companyId: existing.companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "company_claim.cancelled",
      targetType: "CompanyClaimRequest",
      targetId: claimRequestId,
      metadata: {},
    });

    await maybeRevertToUnclaimed(tx, existing.companyId);
    return { claimId: claimRequestId, companyId: existing.companyId };
  });
}

export type ActiveClaimForUser = {
  id: string;
  status: string;
  requestedAt: Date;
  company: { id: string; name: string; documentNormalized: string | null };
};

/** Usada pelo guard central (lib/auth-server.ts) e pela página de
 * acompanhamento (/company-claim/pending) — nunca inclui dados
 * empresariais além do mínimo necessário para a UI de acompanhamento. */
export async function getActiveClaimRequestForUser(userId: string): Promise<ActiveClaimForUser | null> {
  return prisma.companyClaimRequest.findFirst({
    where: { requesterUserId: userId, status: { in: [...ACTIVE_CLAIM_STATUSES] } },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      company: { select: { id: true, name: true, documentNormalized: true } },
    },
  });
}
