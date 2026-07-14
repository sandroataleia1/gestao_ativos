import type { Prisma, SstProviderCompanyAccessLevel } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";

// Sprint Comercial SST 1.4 (reivindicação) — quando um representante real
// da empresa se cadastra sobre um CNPJ já pré-cadastrado por uma
// consultoria (Company.controlStatus: UNCLAIMED -> CLAIM_PENDING, ver
// app/api/register/route.ts), a empresa precisa decidir, para cada vínculo
// provisório (`authorizationBasis: PROVIDER_PRE_REGISTRATION`), se
// continua autorizando a consultoria ou bloqueia o acesso — nunca uma
// reativação/bloqueio automático, sempre uma decisão explícita de um
// usuário autenticado da empresa (§16-§19).

export type ProvisionalLinkSummary = {
  id: string;
  providerId: string;
  providerName: string;
  accessLevel: SstProviderCompanyAccessLevel;
  createdAt: Date;
};

/** Vínculos ACTIVE só por pré-cadastro da consultoria, ainda não revisados
 * pela empresa — são os que bloqueiam a finalização da reivindicação
 * (`Company.controlStatus: CLAIM_PENDING -> CLAIMED`, ver §19). */
export async function getUnresolvedProvisionalLinks(companyId: string): Promise<ProvisionalLinkSummary[]> {
  const links = await prisma.sstProviderCompany.findMany({
    where: { companyId, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE", companyReviewedAt: null },
    include: { provider: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return links.map((link) => ({
    id: link.id,
    providerId: link.providerId,
    providerName: link.provider.name,
    accessLevel: link.accessLevel,
    createdAt: link.createdAt,
  }));
}

export async function hasUnresolvedProvisionalLinks(companyId: string): Promise<boolean> {
  const count = await prisma.sstProviderCompany.count({
    where: { companyId, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE", companyReviewedAt: null },
  });
  return count > 0;
}

/** Se não sobrar nenhuma decisão provisória pendente, finaliza a
 * reivindicação (`CLAIM_PENDING -> CLAIMED`, `claimedAt: now()`) — nunca
 * conclui o onboarding com um vínculo provisório sem revisão (§19). Chamado
 * sempre dentro da mesma transação da decisão que pode ter zerado a
 * contagem. */
async function finalizeClaimIfResolved(tx: Prisma.TransactionClient, companyId: string): Promise<boolean> {
  const remaining = await tx.sstProviderCompany.count({
    where: { companyId, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE", companyReviewedAt: null },
  });
  if (remaining > 0) return false;

  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { controlStatus: true } });
  if (company.controlStatus !== "CLAIM_PENDING") return false;

  await tx.company.update({ where: { id: companyId }, data: { controlStatus: "CLAIMED", claimedAt: new Date() } });
  return true;
}

export type ClaimDecision = "CONTINUE" | "BLOCK";

export type ClaimDecisionResult = {
  link: { id: string; status: string; accessLevel: SstProviderCompanyAccessLevel };
  claimFinalized: boolean;
};

/** Aplica a decisão da empresa sobre UM vínculo provisório (§17/§18) —
 * `relationshipId` é sempre revalidado contra `companyId` (nunca confia que
 * o client só mostrou vínculos da própria empresa) e contra o estado
 * esperado (ACTIVE + PROVIDER_PRE_REGISTRATION + ainda não revisado) —
 * decidir duas vezes sobre o mesmo vínculo (ex.: duplo clique) sempre falha
 * com NotFoundError na segunda vez, nunca aplica a ação de novo. */
export async function resolveClaimDecision(
  companyId: string,
  actor: { id: string; name: string },
  relationshipId: string,
  decision: ClaimDecision,
  accessLevel?: SstProviderCompanyAccessLevel,
): Promise<ClaimDecisionResult> {
  const link = await prisma.sstProviderCompany.findFirst({
    where: {
      id: relationshipId,
      companyId,
      authorizationBasis: "PROVIDER_PRE_REGISTRATION",
      status: "ACTIVE",
      companyReviewedAt: null,
    },
    include: { provider: { select: { name: true } } },
  });
  if (!link) throw new NotFoundError("Vínculo provisório não encontrado ou já revisado.");

  return prisma.$transaction(async (tx) => {
    if (decision === "CONTINUE") {
      const updated = await tx.sstProviderCompany.update({
        where: { id: link.id },
        data: {
          authorizationBasis: "COMPANY_APPROVAL",
          companyReviewedAt: new Date(),
          companyReviewedByUserId: actor.id,
          approvedByUserId: actor.id,
          approvedAt: new Date(),
          ...(accessLevel ? { accessLevel } : {}),
        },
      });
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "sst_provider.claim_continue",
        targetType: "SstProviderCompany",
        targetId: link.id,
        targetLabel: link.provider.name,
        metadata: { providerId: link.providerId, accessLevel: updated.accessLevel },
      });
      const claimFinalized = await finalizeClaimIfResolved(tx, companyId);
      return { link: updated, claimFinalized };
    }

    const updated = await tx.sstProviderCompany.update({
      where: { id: link.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        companyReviewedAt: new Date(),
        companyReviewedByUserId: actor.id,
      },
    });
    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "sst_provider.claim_block",
      targetType: "SstProviderCompany",
      targetId: link.id,
      targetLabel: link.provider.name,
      metadata: { providerId: link.providerId },
    });
    const claimFinalized = await finalizeClaimIfResolved(tx, companyId);
    return { link: updated, claimFinalized };
  });
}
