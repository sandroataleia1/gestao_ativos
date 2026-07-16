// Sprint SST 1.4E, §23 — resolução de navegação SEGURA. Nunca armazena uma
// URL absoluta enviada/persistida livremente — `Notification.actionKey` é
// sempre uma das chaves fixas abaixo, nunca um valor arbitrário. Este
// resolver só decide QUAL ROTA existente corresponde à ação — a
// AUTORIZAÇÃO de verdade acontece sempre na rota de destino, através dos
// guards já existentes (requireCompanyOrDeny/requireSstAuthOrDeny/
// requirePlatformRoleOrDeny) — nunca aqui. Um `actionKey` desconhecido, ou
// usado fora do portal a que pertence, nunca gera URL nenhuma (retorna
// `null` — a UI mostra a notificação sem botão de ação).

export type NotificationActionContext =
  | { portal: "COMPANY" }
  | { portal: "SST_PROVIDER" }
  | { portal: "PLATFORM" };

export type NotificationForAction = {
  actionKey: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

function readCompanyIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).companyId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Retorna a rota de destino para uma notificação, ou `null` se o
 * `actionKey` for desconhecido ou não pertencer ao portal do contexto
 * atual. Ao clicar: 1) marcar como lida; 2) navegar para esta rota; 3) a
 * própria rota revalida autorização (nunca confiar só nisto aqui).
 */
export function resolveNotificationAction(notification: NotificationForAction, context: NotificationActionContext): string | null {
  if (!notification.actionKey) return null;

  switch (notification.actionKey) {
    case "COMPANY_REVIEW_SST_ACCESS":
      if (context.portal !== "COMPANY") return null;
      return "/configuracoes/sst-providers";

    case "SST_OPEN_COMPANY": {
      if (context.portal !== "SST_PROVIDER") return null;
      const companyId = readCompanyIdFromMetadata(notification.metadata);
      // Sem companyId conhecido, nunca inventa uma rota — cai para a
      // listagem (nunca abre "outra" empresa por engano).
      return companyId ? `/sst/companies/${companyId}` : "/sst/companies";
    }

    case "SST_VIEW_RELATIONSHIP":
      if (context.portal !== "SST_PROVIDER") return null;
      return "/sst/companies";

    case "PLATFORM_REVIEW_CLAIM": {
      if (context.portal !== "PLATFORM") return null;
      if (notification.entityType === "CompanyClaimRequest" && notification.entityId) {
        return `/platform-admin/company-claims/${notification.entityId}`;
      }
      return "/platform-admin/company-claims";
    }

    case "PLATFORM_REVIEW_DISPUTE":
      if (context.portal !== "PLATFORM") return null;
      return "/platform-admin/company-claims";

    default:
      // actionKey desconhecido (ex.: versão antiga, typo, valor forjado em
      // teste) — nunca gera URL.
      return null;
  }
}
