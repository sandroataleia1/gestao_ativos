import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { resolveTrainingAuthorization } from "@/lib/training-authorization";
import type { SstProviderCreateInput, SstProviderLinkStatusUpdateInput } from "@/lib/validations/sst-provider";

export const providerLinkInclude = {
  provider: { select: { id: true, name: true, document: true, email: true, phone: true, active: true } },
} as const;

/** Lista os vínculos (SstProviderCompany) da empresa atual, com o provider
 * aninhado — nunca uma lista global de SstProvider, que não tem companyId
 * (ver docs/sst-providers.md). */
export async function getProviderLinksForCompany(companyId: string) {
  return prisma.sstProviderCompany.findMany({
    where: { companyId },
    include: providerLinkInclude,
    orderBy: { createdAt: "desc" },
  });
}

/** Cria o SstProvider e o vínculo SstProviderCompany (status: PENDING) na
 * mesma transação — o vínculo só vira ACTIVE por uma ação separada de
 * autorização (updateProviderLinkStatus). Registra `sst_provider.create`
 * no audit trail (nunca inclui `document` no metadata/targetLabel — CNPJ/
 * CPF é dado sensível, ver lib/audit.ts). */
export async function createProviderWithLink(
  companyId: string,
  actor: { id: string; name: string },
  input: SstProviderCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const provider = await tx.sstProvider.create({
      data: {
        name: input.name,
        document: input.document,
        email: input.email,
        phone: input.phone,
      },
    });

    const link = await tx.sstProviderCompany.create({
      data: {
        providerId: provider.id,
        companyId,
        accessLevel: input.accessLevel,
        status: "PENDING",
      },
      include: providerLinkInclude,
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: "sst_provider.create",
      targetType: "SstProviderCompany",
      targetId: link.id,
      targetLabel: provider.name,
      metadata: { providerId: provider.id, accessLevel: input.accessLevel },
    });

    return link;
  });
}

const LINK_STATUS_ACTION = {
  ACTIVE: "sst_provider.approve",
  SUSPENDED: "sst_provider.suspend",
  REVOKED: "sst_provider.revoke",
} as const;

/** Autoriza/suspende/revoga um vínculo — sempre com ownership check
 * (id + companyId) antes de agir. Registra a ação de audit correspondente
 * ao novo status (`sst_provider.approve`/`suspend`/`revoke`). */
export async function updateProviderLinkStatus(
  companyId: string,
  actor: { id: string; name: string },
  linkId: string,
  input: SstProviderLinkStatusUpdateInput,
) {
  const existing = await prisma.sstProviderCompany.findFirst({
    where: { id: linkId, companyId },
    include: providerLinkInclude,
  });
  if (!existing) throw new NotFoundError("Vínculo com prestador SST não encontrado.");

  return prisma.$transaction(async (tx) => {
    const link = await tx.sstProviderCompany.update({
      where: { id: linkId },
      data: {
        status: input.status,
        ...(input.status === "ACTIVE" ? { approvedByUserId: actor.id, approvedAt: new Date() } : {}),
        ...(input.status === "REVOKED" ? { revokedAt: new Date() } : {}),
      },
      include: providerLinkInclude,
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      action: LINK_STATUS_ACTION[input.status],
      targetType: "SstProviderCompany",
      targetId: link.id,
      targetLabel: existing.provider.name,
      metadata: { providerId: existing.providerId, previousStatus: existing.status, newStatus: input.status },
    });

    return link;
  });
}

/** Prestadores que a empresa pode escolher para gerenciar um
 * CompanyTraining — vínculo ACTIVE com accessLevel OPERATION ou
 * ADMINISTRATION (VIEW nunca gerencia). Usado pelo seletor "Consultoria
 * SST" do formulário de treinamento. */
export async function getAuthorizedProvidersForTraining(companyId: string) {
  const links = await prisma.sstProviderCompany.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      accessLevel: { in: ["OPERATION", "ADMINISTRATION"] },
      provider: { active: true },
    },
    select: { provider: { select: { id: true, name: true } } },
    orderBy: { provider: { name: "asc" } },
  });
  return links.map((link) => link.provider);
}

/**
 * Garante que um `SstProvider` pode gerenciar um `CompanyTraining` da
 * empresa: existe e está `active`; existe `SstProviderCompany` ACTIVE entre
 * ele e a empresa; `accessLevel` é OPERATION ou ADMINISTRATION (VIEW nunca
 * gerencia). Lança ValidationError com mensagem amigável no primeiro passo
 * que falhar. Implementado sobre `resolveTrainingAuthorization`
 * (lib/training-authorization.ts) — única fonte da consulta a
 * SstProvider/SstProviderCompany, em vez de repetir a query aqui.
 */
export async function assertProviderCanManage(companyId: string, providerId: string) {
  const authorization = await resolveTrainingAuthorization(companyId, "EXTERNAL_PROVIDER", providerId);

  if (!authorization.providerActive) {
    throw new ValidationError("Prestador SST inválido ou inativo.");
  }

  if (authorization.providerStatus !== "ACTIVE") {
    throw new ValidationError("Este prestador não está autorizado para esta empresa.");
  }

  if (authorization.providerAccessLevel === "VIEW") {
    throw new ValidationError("Este prestador só tem acesso de visualização e não pode gerenciar o treinamento.");
  }
}
