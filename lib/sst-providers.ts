import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { resolveTrainingAuthorization } from "@/lib/training-authorization";
import type { SstProviderLinkCreateInput, SstProviderLinkStatusUpdateInput } from "@/lib/validations/sst-provider";
import {
  resolveNotificationByDedupeKey,
  notifyCompanyAccessRequestResolved,
  notifyProviderAccessApproved,
  notifyProviderAccessRejected,
  notifyProviderAccessSuspended,
  notifyProviderAccessRevoked,
  notifyProviderAccessLevelChanged,
} from "@/lib/notifications";

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

// Sprint SST 1.4B, §4 — matriz de transições permitidas. Antes desta sprint
// a única guarda era "REVOKED/REJECTED nunca aceitam PATCH" (estados
// terminais), o que deixava passar transições sem sentido como PENDING ->
// SUSPENDED ou PENDING -> REVOKED direto pela API (pulando a aprovação).
// PENDING só aceita ACTIVE (aprovar) ou REJECTED (recusar); ACTIVE/SUSPENDED
// podem transitar entre si e para REVOKED; REVOKED/REJECTED são terminais
// (guarda já existente acima, mantida).
// Sprint SST 1.4E, §11 — `ACTIVE: [..., "ACTIVE"]` adicionado (extensão
// mínima, mesmo espírito de SUSPENDED -> ACTIVE já existente) para permitir
// uma troca de `accessLevel` SEM sair de ACTIVE — a única forma real de
// disparar `SST_ACCESS_LEVEL_CHANGED` (spec §11/§20), já que antes desta
// sprint o nível só mudava como efeito colateral da aprovação inicial
// (PENDING -> ACTIVE). Nunca reexecuta os campos de aprovação
// (`approvedAt`/`companyReviewedAt`) nesse caminho — só quando a transição
// de origem é genuinamente PENDING -> ACTIVE (ver corpo da função abaixo).
const ALLOWED_STATUS_TRANSITIONS: Record<string, readonly SstProviderLinkStatusUpdateInput["status"][]> = {
  PENDING: ["ACTIVE", "REJECTED"],
  ACTIVE: ["SUSPENDED", "REVOKED", "ACTIVE"],
  SUSPENDED: ["ACTIVE", "REVOKED"],
};

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
    include: { ...providerLinkInclude, company: { select: { name: true, tradeName: true } } },
  });
  if (!existing) throw new NotFoundError("Vínculo com prestador SST não encontrado.");

  if (existing.status === "REVOKED" || existing.status === "REJECTED") {
    throw new ValidationError(
      "Este vínculo já foi encerrado e não pode ser alterado. É necessário um novo pedido de autorização.",
    );
  }

  // Sprint SST 1.4E, §11 — uma chamada ACTIVE -> ACTIVE só faz sentido (e só
  // é permitida) quando de fato muda o accessLevel; nunca um "re-aprovar"
  // silencioso do mesmo nível.
  if (existing.status === "ACTIVE" && input.status === "ACTIVE" && (!input.accessLevel || input.accessLevel === existing.accessLevel)) {
    throw new ValidationError("Informe um nível de acesso diferente do atual para registrar uma alteração.");
  }

  const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowedNextStatuses.includes(input.status)) {
    throw new ValidationError(
      `Não é possível alterar um vínculo de "${existing.status}" para "${input.status}".`,
    );
  }

  const companyName = existing.company.tradeName || existing.company.name;
  // Transição real desta chamada (distinta do `status` alvo): PENDING ->
  // ACTIVE é uma aprovação; ACTIVE -> ACTIVE é só uma troca de nível.
  const isApprovalFromPending = existing.status === "PENDING" && input.status === "ACTIVE";
  const isLevelChangeOnly = existing.status === "ACTIVE" && input.status === "ACTIVE";

  return prisma.$transaction(async (tx) => {
    // Sprint SST 1.4B, §7/§9 — o `existing.status` acima foi lido FORA desta
    // transação; duas chamadas concorrentes sobre o MESMO vínculo (ex.:
    // duplo clique em "Autorizar", ou aprovar e recusar quase ao mesmo
    // tempo em duas abas) poderiam ambas passar pela validação de transição
    // com o mesmo status antigo e ambas aplicarem sua mudança em sequência.
    // `updateMany` com `status: existing.status` no WHERE faz o Postgres
    // decidir atomicamente: só a primeira a commitar de fato muda o
    // registro; a segunda vê `count: 0` e recebe um erro amigável em vez de
    // sobrescrever silenciosamente a decisão já aplicada.
    const { count } = await tx.sstProviderCompany.updateMany({
      where: { id: linkId, status: existing.status },
      data: {
        status: input.status,
        ...(isApprovalFromPending
          ? {
              approvedByUserId: actor.id,
              approvedAt: new Date(),
              authorizationBasis: "COMPANY_APPROVAL",
              companyReviewedAt: new Date(),
              companyReviewedByUserId: actor.id,
              ...(input.accessLevel ? { accessLevel: input.accessLevel } : {}),
            }
          : {}),
        ...(isLevelChangeOnly ? { accessLevel: input.accessLevel } : {}),
        ...(input.status === "REVOKED" ? { revokedAt: new Date() } : {}),
        ...(input.status === "REJECTED"
          ? { companyReviewedAt: new Date(), companyReviewedByUserId: actor.id }
          : {}),
      },
    });
    if (count === 0) {
      throw new ConflictError(
        "Este vínculo já foi alterado por outra requisição. Recarregue a página e tente novamente.",
      );
    }
    const link = await tx.sstProviderCompany.findUniqueOrThrow({
      where: { id: linkId },
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

    // Sprint SST 1.4E, §11 — notificações transacionais. `stateVersion` usa
    // `link.updatedAt` (já persistido nesta mesma transação) como
    // identificador estável da transição — nunca um timestamp gerado à
    // parte, nunca aleatório (§10).
    const stateVersion = link.updatedAt.getTime().toString();
    const notifyParams = { sstProviderId: existing.providerId, relationshipId: link.id, companyId, companyName, stateVersion };

    if (isApprovalFromPending) {
      await resolveNotificationByDedupeKey("COMPANY", `company:sst-access-request:${link.id}`, tx);
      await notifyCompanyAccessRequestResolved(
        { companyId, relationshipId: link.id, finalStatus: "ACTIVE", providerName: existing.provider.name },
        tx,
      );
      await notifyProviderAccessApproved({ ...notifyParams, accessLevel: link.accessLevel }, tx);
    } else if (isLevelChangeOnly) {
      await notifyProviderAccessLevelChanged(
        { ...notifyParams, previousAccessLevel: existing.accessLevel, newAccessLevel: link.accessLevel },
        tx,
      );
    } else if (input.status === "REJECTED") {
      await resolveNotificationByDedupeKey("COMPANY", `company:sst-access-request:${link.id}`, tx);
      await notifyCompanyAccessRequestResolved(
        { companyId, relationshipId: link.id, finalStatus: "REJECTED", providerName: existing.provider.name },
        tx,
      );
      await notifyProviderAccessRejected(notifyParams, tx);
    } else if (input.status === "SUSPENDED") {
      await notifyProviderAccessSuspended(notifyParams, tx);
    } else if (input.status === "REVOKED") {
      await notifyProviderAccessRevoked(notifyParams, tx);
    }

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
