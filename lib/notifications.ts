import { Prisma } from "@/app/generated/prisma/client";
import type { NotificationAudience, NotificationType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertNoSecrets } from "@/lib/platform-audit";
import { getNotificationVisibilityPolicy } from "@/lib/notifications-visibility";

// Sprint SST 1.4E — serviço central de criação/resolução de notificações,
// compartilhado pelos três portais. Nunca aceita companyId/sstProviderId/
// título/mensagem vindos do navegador em fluxo de domínio — todo chamador
// deste módulo é um serviço de domínio já confiável (lib/sst-providers.ts,
// lib/sst-company-provisioning.ts, lib/company-claim.ts,
// lib/company-claim-request.ts, lib/platform-admin-claims.ts), nunca uma
// rota HTTP diretamente.

export type CreateNotificationInput = {
  audience: NotificationAudience;
  companyId?: string | null;
  sstProviderId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  actionKey?: string | null;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

export type CreateNotificationResult = {
  notification: Prisma.NotificationGetPayload<Record<string, never>>;
  dedupeHit: boolean;
};

function assertAudienceScope(input: CreateNotificationInput): void {
  const policy = getNotificationVisibilityPolicy(input.type);
  if (policy.audience !== input.audience) {
    throw new Error(`createNotification: tipo ${input.type} pertence à audiência ${policy.audience}, não a ${input.audience}.`);
  }
  if (input.audience === "COMPANY") {
    if (!input.companyId) throw new Error("createNotification: audience COMPANY exige companyId.");
    if (input.sstProviderId) throw new Error("createNotification: audience COMPANY nunca aceita sstProviderId.");
  }
  if (input.audience === "SST_PROVIDER") {
    if (!input.sstProviderId) throw new Error("createNotification: audience SST_PROVIDER exige sstProviderId.");
    if (input.companyId) throw new Error("createNotification: audience SST_PROVIDER nunca aceita companyId.");
  }
  if (input.audience === "PLATFORM") {
    if (input.companyId || input.sstProviderId) {
      throw new Error("createNotification: audience PLATFORM nunca aceita companyId nem sstProviderId.");
    }
  }
  if (!input.dedupeKey.trim()) {
    throw new Error("createNotification: dedupeKey é obrigatória.");
  }
}

/**
 * Cria uma notificação institucional — idempotente por `(audience,
 * dedupeKey)`: uma segunda chamada com a mesma chave nunca duplica, nunca
 * sobrescreve o conteúdo já persistido (retorna a linha existente,
 * `dedupeHit: true`). Aceita `Prisma.TransactionClient` opcional para ser
 * criada na MESMA transação da alteração de domínio que a originou (§9/§11
 * — falha da transação nunca deixa uma notificação órfã).
 */
export async function createNotification(
  input: CreateNotificationInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CreateNotificationResult> {
  assertAudienceScope(input);
  assertNoSecrets(input.title, "title");
  assertNoSecrets(input.message, "message");
  assertNoSecrets(input.metadata ?? null);

  const policy = getNotificationVisibilityPolicy(input.type);

  // Sprint SST 1.4E.1 — o padrão anterior (`findUnique` antes de `create`,
  // com `create`-então-`catch(P2002)` só para o cliente de topo) reduzia a
  // janela de corrida mas não a eliminava: duas transações diferentes podem
  // observar ausência da mesma `dedupeKey` no `findUnique` e tentar `create`
  // ao mesmo tempo — a perdedora recebia P2002 e, se `tx` fosse uma
  // transação interativa de um chamador, isso abortava a transação inteira
  // (Postgres exige ROLLBACK antes de aceitar qualquer novo comando).
  //
  // `createMany({ skipDuplicates: true })` compila, no Postgres, para
  // `INSERT ... ON CONFLICT DO NOTHING` — uma colisão de unique constraint
  // deixa de ser um ERRO de banco (nunca gera P2002, nunca aborta a
  // transação); ela só faz o INSERT não afetar nenhuma linha. `count` do
  // resultado já diz, sozinho, se ESTA chamada inseriu (`count: 1` →
  // `dedupeHit: false`) ou perdeu a corrida/repetiu um retry (`count: 0` →
  // `dedupeHit: true`) — nunca precisa comparar conteúdo para decidir.
  //
  // A releitura seguinte é SEMPRE por `findUniqueOrThrow` (nunca monta o
  // retorno a partir do `input` local): um dedupe-hit devolve o conteúdo
  // REAL já persistido (título/mensagem/metadata/actionKey/resolvedAt da
  // primeira chamada), nunca os valores desta segunda chamada — um
  // dedupe-hit é um retry do mesmo evento, nunca uma edição editorial (§8).
  const { count } = await tx.notification.createMany({
    data: [
      {
        audience: input.audience,
        companyId: input.companyId ?? null,
        sstProviderId: input.sstProviderId ?? null,
        type: input.type,
        severity: policy.severity,
        title: input.title,
        message: input.message,
        actionKey: input.actionKey !== undefined ? input.actionKey : policy.defaultActionKey,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    ],
    skipDuplicates: true,
  });

  const notification = await tx.notification.findUniqueOrThrow({
    where: { audience_dedupeKey: { audience: input.audience, dedupeKey: input.dedupeKey } },
  });

  return { notification, dedupeHit: count === 0 };
}

/** Resolve (globalmente) a notificação de uma dedupeKey específica — nunca
 * remove, nunca marca como lida para ninguém, só retira da contagem
 * "acionável" (ver PendingSignal.RESOLUTION em lib/notifications-visibility.ts). */
export async function resolveNotificationByDedupeKey(
  audience: NotificationAudience,
  dedupeKey: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const { count } = await tx.notification.updateMany({
    where: { audience, dedupeKey, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return count;
}

/** Resolve todas as notificações ainda pendentes associadas a uma entidade
 * (ex.: todas as PLATFORM_COMPANY_CLAIM_DISPUTED de uma Company quando a
 * disputa termina). */
export async function resolveNotificationsForEntity(
  entityType: string,
  entityId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const { count } = await tx.notification.updateMany({
    where: { entityType, entityId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Funções de caso de uso — montam título/mensagem/metadata no SERVIDOR
// (nunca a partir de input do navegador). Cada uma corresponde a um dos
// eventos administrativos listados no spec da Sprint SST 1.4E, §9.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient | typeof prisma;

export async function notifyCompanyAccessRequested(
  params: { companyId: string; relationshipId: string; providerName: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "COMPANY",
      companyId: params.companyId,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Nova solicitação de acesso SST",
      message: `${params.providerName} solicitou autorização para operar os dados de SST desta empresa.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `company:sst-access-request:${params.relationshipId}`,
      metadata: { relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyCompanyAccessRequestResolved(
  params: { companyId: string; relationshipId: string; finalStatus: "ACTIVE" | "REJECTED"; providerName: string },
  tx: Tx = prisma,
) {
  const approved = params.finalStatus === "ACTIVE";
  return createNotification(
    {
      audience: "COMPANY",
      companyId: params.companyId,
      type: "COMPANY_SST_ACCESS_REQUEST_RESOLVED",
      title: "Solicitação de acesso SST analisada",
      message: approved
        ? `A solicitação de ${params.providerName} foi aprovada.`
        : `A solicitação de ${params.providerName} não foi aprovada.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `company:sst-access-request-resolved:${params.relationshipId}:${params.finalStatus}`,
      metadata: { relationshipId: params.relationshipId, finalStatus: params.finalStatus },
    },
    tx,
  );
}

export async function notifyProviderAccessApproved(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; accessLevel: string; stateVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_ACCESS_APPROVED",
      title: "Acesso liberado",
      message: `A ${params.companyName} autorizou sua consultoria com nível ${ACCESS_LEVEL_LABEL[params.accessLevel] ?? params.accessLevel}.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:access-approved:${params.relationshipId}:${params.stateVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId, accessLevel: params.accessLevel },
    },
    tx,
  );
}

export async function notifyProviderAccessRejected(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; stateVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_ACCESS_REJECTED",
      title: "Solicitação não aprovada",
      message: `A ${params.companyName} não autorizou o acesso solicitado.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:access-rejected:${params.relationshipId}:${params.stateVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyProviderAccessSuspended(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; stateVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_ACCESS_SUSPENDED",
      title: "Acesso suspenso",
      message: `O acesso à ${params.companyName} foi temporariamente suspenso.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:access-suspended:${params.relationshipId}:${params.stateVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyProviderAccessRevoked(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; stateVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_ACCESS_REVOKED",
      title: "Acesso encerrado",
      message: `A ${params.companyName} encerrou a autorização da consultoria.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:access-revoked:${params.relationshipId}:${params.stateVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

const ACCESS_LEVEL_LABEL: Record<string, string> = {
  VIEW: "consulta",
  OPERATION: "operacional",
  ADMINISTRATION: "administrativo",
};

export async function notifyProviderAccessLevelChanged(
  params: {
    sstProviderId: string;
    relationshipId: string;
    companyId: string;
    companyName: string;
    previousAccessLevel: string;
    newAccessLevel: string;
    stateVersion: string;
  },
  tx: Tx = prisma,
) {
  const previousLabel = ACCESS_LEVEL_LABEL[params.previousAccessLevel] ?? params.previousAccessLevel;
  const newLabel = ACCESS_LEVEL_LABEL[params.newAccessLevel] ?? params.newAccessLevel;
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_ACCESS_LEVEL_CHANGED",
      title: "Permissão atualizada",
      message: `A ${params.companyName} alterou o nível de acesso de ${previousLabel} para ${newLabel}.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:access-level:${params.relationshipId}:${params.newAccessLevel}:${params.stateVersion}`,
      metadata: {
        companyId: params.companyId,
        relationshipId: params.relationshipId,
        previousAccessLevel: params.previousAccessLevel,
        newAccessLevel: params.newAccessLevel,
      },
    },
    tx,
  );
}

export async function notifyProviderCompanyClaimStarted(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; claimVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_COMPANY_CLAIM_STARTED",
      title: "Empresa assumiu o cadastro",
      message: `A ${params.companyName} concluiu a solicitação de controle e está analisando a continuidade da autorização.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:claim-started:${params.companyId}:${params.relationshipId}:${params.claimVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyProviderAuthorizationConfirmed(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; reviewVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_AUTHORIZATION_CONFIRMED",
      title: "Autorização confirmada",
      message: `A ${params.companyName} confirmou a continuidade da autorização da sua consultoria.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:authorization-confirmed:${params.relationshipId}:${params.reviewVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyProviderAuthorizationBlocked(
  params: { sstProviderId: string; relationshipId: string; companyId: string; companyName: string; reviewVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "SST_PROVIDER",
      sstProviderId: params.sstProviderId,
      type: "SST_AUTHORIZATION_BLOCKED",
      title: "Acesso encerrado",
      message: `A ${params.companyName} encerrou a autorização da consultoria.`,
      entityType: "SstProviderCompany",
      entityId: params.relationshipId,
      dedupeKey: `provider:authorization-blocked:${params.relationshipId}:${params.reviewVersion}`,
      metadata: { companyId: params.companyId, relationshipId: params.relationshipId },
    },
    tx,
  );
}

export async function notifyPlatformClaimRequested(
  params: { claimRequestId: string; companyId: string; claimVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "PLATFORM",
      type: "PLATFORM_COMPANY_CLAIM_REQUESTED",
      title: "Nova reivindicação empresarial",
      message: "Uma solicitação de controle empresarial aguarda análise.",
      entityType: "CompanyClaimRequest",
      entityId: params.claimRequestId,
      // Sprint SST 1.4E.1 — `claimVersion` (= `claim.requestedAt.getTime()`,
      // já persistido na mesma transação em que a claim entra em PENDING,
      // seja no nascimento ou numa reabertura) evita que uma reabertura
      // legítima (REJECTED/CANCELLED/EXPIRED -> PENDING, mesma linha/mesmo
      // `claimRequestId`) encontre a Notification ANTERIOR já resolvida e a
      // devolva como está (dedupe-hit) sem nunca voltar a ficar pendente.
      // Cada ciclo passa a ter uma dedupeKey própria — mesmo componente já
      // usado por `notifyProviderCompanyClaimStarted` no mesmo bloco de
      // `createOrReuseClaimRequest`.
      dedupeKey: `platform:claim-requested:${params.claimRequestId}:${params.claimVersion}`,
      metadata: { companyId: params.companyId },
    },
    tx,
  );
}

export async function notifyPlatformClaimDisputed(
  params: { companyId: string; disputeVersion: string },
  tx: Tx = prisma,
) {
  return createNotification(
    {
      audience: "PLATFORM",
      type: "PLATFORM_COMPANY_CLAIM_DISPUTED",
      title: "Empresa em disputa",
      message: "Uma empresa possui múltiplas solicitações de controle.",
      entityType: "Company",
      entityId: params.companyId,
      dedupeKey: `platform:claim-disputed:${params.companyId}:${params.disputeVersion}`,
      metadata: { companyId: params.companyId },
    },
    tx,
  );
}
