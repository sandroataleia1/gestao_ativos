import type { Prisma, SstProviderCompanyAccessLevel } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/api-errors";
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
 * contagem.
 *
 * Sprint SST 1.4B, §12 — uma empresa pode ter MAIS de um vínculo provisório
 * (mais de uma consultoria pré-cadastrou a mesma empresa). Duas decisões
 * concorrentes sobre vínculos DIFERENTES da mesma empresa (ex.: duas abas,
 * cada uma decidindo um vínculo) rodam em transações separadas; em Read
 * Committed (padrão do Postgres), o COUNT de cada transação só enxerga o
 * que já foi commitado por fora — então é possível as duas contarem "1
 * restante" (a decisão da outra) e nenhuma finalizar o claim, mesmo que
 * depois das duas commitarem não sobre nada pendente. Isso trava a empresa
 * em CLAIM_PENDING para sempre: app/(app)/layout.tsx redireciona todo
 * carregamento para /onboarding/sst-providers, que por sua vez redireciona
 * de volta para /dashboard assim que `getUnresolvedProvisionalLinks` vier
 * vazio — um loop sem saída. `SELECT ... FOR UPDATE` na linha da Company
 * serializa as duas transações aqui: a segunda só executa seu próprio COUNT
 * depois que a primeira já commitou, então sempre vê o estado final
 * correto (mesmo padrão já usado em lib/training-participants.ts). */
async function lockCompanyRow(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
}

async function finalizeClaimIfResolved(tx: Prisma.TransactionClient, companyId: string): Promise<boolean> {
  // O lock já foi adquirido no início da transação chamadora
  // (resolveClaimDecision) — chamar de novo aqui é barato (mesma linha,
  // mesma transação, Postgres só reconfirma que já é dona do lock) e
  // mantém esta função segura por si só para qualquer chamador futuro.
  await lockCompanyRow(tx, companyId);

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
 * esperado (ACTIVE + PROVIDER_PRE_REGISTRATION + ainda não revisado). A
 * checagem inicial (`findFirst`, abaixo) cobre o caso comum (chamada
 * repetida depois que a primeira já commitou); duas chamadas GENUINAMENTE
 * concorrentes sobre o mesmo vínculo (ex.: duplo clique) poderiam as duas
 * passar por essa checagem antes de qualquer commit — por isso o `update`
 * dentro da transação (abaixo) reconfirma `companyReviewedAt: null` no
 * próprio WHERE (Sprint SST 1.4B, §12): só a primeira a commitar de fato
 * aplica a decisão; a segunda recebe `ConflictError`, nunca sobrescreve
 * silenciosamente. */
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

  const guardedWhere = { id: link.id, companyReviewedAt: null } as const;

  return prisma.$transaction(async (tx) => {
    // Trava a linha da Company ANTES de qualquer escrita nesta transação —
    // não só dentro de `finalizeClaimIfResolved` no final. Descoberto por um
    // teste de concorrência real (Sprint SST 1.4B, §12): `logAudit` faz um
    // INSERT em AuditLog com FK para Company, e o Postgres adquire um lock
    // FOR KEY SHARE na linha referenciada durante esse INSERT — se o lock
    // FOR UPDATE só fosse pedido depois (só dentro de
    // `finalizeClaimIfResolved`), duas transações concorrentes decidindo
    // vínculos DIFERENTES da mesma empresa já teriam, cada uma, seu
    // próprio FOR KEY SHARE (do próprio logAudit) quando tentasse promover
    // para FOR UPDATE — cada uma esperando a outra soltar o FOR KEY SHARE
    // dela: deadlock real (Postgres 40P01), reproduzido nesta sprint.
    // Travar aqui, antes do `logAudit`, garante que só uma transação chega a
    // fazer qualquer escrita relacionada a esta Company por vez.
    await lockCompanyRow(tx, companyId);

    if (decision === "CONTINUE") {
      const { count } = await tx.sstProviderCompany.updateMany({
        where: guardedWhere,
        data: {
          authorizationBasis: "COMPANY_APPROVAL",
          companyReviewedAt: new Date(),
          companyReviewedByUserId: actor.id,
          approvedByUserId: actor.id,
          approvedAt: new Date(),
          ...(accessLevel ? { accessLevel } : {}),
        },
      });
      if (count === 0) {
        throw new ConflictError("Este vínculo já foi revisado por outra requisição.");
      }
      const updated = await tx.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
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

    const { count } = await tx.sstProviderCompany.updateMany({
      where: guardedWhere,
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        companyReviewedAt: new Date(),
        companyReviewedByUserId: actor.id,
      },
    });
    if (count === 0) {
      throw new ConflictError("Este vínculo já foi revisado por outra requisição.");
    }
    const updated = await tx.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
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
