import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { resolveTrainingAuthorization } from "@/lib/training-authorization";
import type { SstProviderLinkCreateInput, SstProviderLinkStatusUpdateInput } from "@/lib/validations/sst-provider";

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

/** Contagem de solicitações PENDING desta empresa — usado no badge da
 * página de prestadores e no aviso discreto do dashboard (Sprint Comercial
 * SST 1.4, §14). */
export async function countPendingProviderRequests(companyId: string) {
  return prisma.sstProviderCompany.count({ where: { companyId, status: "PENDING" } });
}

const MAX_SEARCH_RESULTS = 10;

/** Busca prestadores SST já cadastrados no sistema (globais — `SstProvider`
 * não tem `companyId`, ver docs/sst-providers.md) por nome, para a empresa
 * escolher e autorizar — nunca cria um registro novo pela tela da empresa
 * (Sprint "busca de SST cadastrada com seleção e autorização"). Exclui
 * prestadores inativos e qualquer um que já tenha ALGUM vínculo com esta
 * empresa (em qualquer status — inclusive REVOKED, já que
 * `@@unique([providerId, companyId])` impede um segundo vínculo para o
 * mesmo par; esse já aparece na tabela de vínculos existentes da própria
 * tela, não faz sentido reoferecer na busca). Retorna só `id`/`name`/
 * `document` — o suficiente para a empresa reconhecer a consultoria certa
 * (útil quando duas têm nomes parecidos); e-mail/telefone só ficam visíveis
 * depois que o vínculo existe (tabela principal da tela).
 */
export async function searchAuthorizableProviders(companyId: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const alreadyLinked = await prisma.sstProviderCompany.findMany({
    where: { companyId },
    select: { providerId: true },
  });

  return prisma.sstProvider.findMany({
    where: {
      active: true,
      name: { contains: trimmed, mode: "insensitive" },
      id: { notIn: alreadyLinked.map((link) => link.providerId) },
    },
    select: { id: true, name: true, document: true },
    orderBy: { name: "asc" },
    take: MAX_SEARCH_RESULTS,
  });
}

/** Vincula um SstProvider JÁ EXISTENTE (encontrado via
 * `searchAuthorizableProviders`) à empresa — cria só o SstProviderCompany
 * (status: PENDING); NUNCA cria um SstProvider novo. `providerId` é sempre
 * revalidado no servidor: precisa existir, estar `active`, e ainda não ter
 * vínculo com esta empresa (nunca confia que o client só mostrou opções
 * válidas — a mesma checagem de "nunca confiar no client" já usada em toda
 * API deste projeto). Autorizar (status: ACTIVE) continua sendo uma ação
 * separada (updateProviderLinkStatus), preservando a distinção de audit
 * trail entre "vínculo criado" e "vínculo aprovado". */
export async function linkExistingProvider(
  companyId: string,
  actor: { id: string; name: string },
  input: SstProviderLinkCreateInput,
) {
  const provider = await prisma.sstProvider.findUnique({ where: { id: input.providerId } });
  if (!provider || !provider.active) {
    throw new ValidationError("Prestador SST inválido ou inativo.");
  }

  const existingLink = await prisma.sstProviderCompany.findUnique({
    where: { providerId_companyId: { providerId: provider.id, companyId } },
    select: { id: true },
  });
  if (existingLink) {
    throw new ConflictError("Este prestador já tem um vínculo com esta empresa.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    // Cinturão de segurança contra corrida (duas abas vinculando o mesmo
    // provider ao mesmo tempo) — a checagem acima já cobre o caso comum,
    // isto pega só a janela entre o SELECT e o INSERT.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Este prestador já tem um vínculo com esta empresa.");
    }
    throw error;
  }
}

const LINK_STATUS_ACTION = {
  ACTIVE: "sst_provider.approve",
  SUSPENDED: "sst_provider.suspend",
  REVOKED: "sst_provider.revoke",
  REJECTED: "sst_provider.reject",
} as const;

/** Autoriza/suspende/revoga/recusa um vínculo — sempre com ownership check
 * (id + companyId) antes de agir. Registra a ação de audit correspondente
 * ao novo status (`sst_provider.approve`/`suspend`/`revoke`/`reject`).
 *
 * REVOKED e REJECTED são estados terminais (Sprint Comercial SST 1.4, §12/
 * §15 — "não existe reativar um revogado", e uma solicitação recusada nunca
 * é reconsiderada automaticamente): uma vez nesses estados, o vínculo nunca
 * mais aceita PATCH — seria necessário um novo pedido de autorização
 * (`linkExistingProvider`/pré-cadastro), nunca uma reativação silenciosa do
 * registro antigo.
 *
 * `accessLevel` só tem efeito quando `status: "ACTIVE"` (a empresa escolhe
 * o nível no momento da aprovação — §14); se omitido, mantém o nível já
 * registrado no vínculo (comportamento anterior, preservado para não quebrar
 * o fluxo de "Autorizar" já existente na tela). */
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

  if (existing.status === "REVOKED" || existing.status === "REJECTED") {
    throw new ValidationError(
      "Este vínculo já foi encerrado e não pode ser alterado. É necessário um novo pedido de autorização.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const link = await tx.sstProviderCompany.update({
      where: { id: linkId },
      data: {
        status: input.status,
        ...(input.status === "ACTIVE"
          ? {
              approvedByUserId: actor.id,
              approvedAt: new Date(),
              authorizationBasis: "COMPANY_APPROVAL",
              companyReviewedAt: new Date(),
              companyReviewedByUserId: actor.id,
              ...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
            }
          : {}),
        ...(input.status === "REVOKED" ? { revokedAt: new Date() } : {}),
        ...(input.status === "REJECTED"
          ? { companyReviewedAt: new Date(), companyReviewedByUserId: actor.id }
          : {}),
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
      metadata: {
        providerId: existing.providerId,
        previousStatus: existing.status,
        newStatus: input.status,
        ...(input.status === "ACTIVE" ? { accessLevel: link.accessLevel } : {}),
      },
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
