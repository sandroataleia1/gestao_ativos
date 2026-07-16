import type { NotificationListItem } from "@/lib/notifications-listing";
import { resolveNotificationAction, type NotificationActionContext } from "@/lib/notification-action";

// Sprint SST 1.4E — DTO enviado ao client. Resolve a rota de navegação no
// SERVIDOR (nunca envia `actionKey`/`metadata` brutos para o client montar
// a URL) — o client só recebe `href` já pronto (ou `null`, quando não há
// ação disponível).

export type ClientNotification = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  href: string | null;
  createdAt: string;
  isRead: boolean;
  isDismissed: boolean;
  isPending: boolean;
};

export function toClientNotification(item: NotificationListItem, context: NotificationActionContext): ClientNotification {
  return {
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    message: item.message,
    href: resolveNotificationAction(
      { actionKey: item.actionKey, entityType: item.entityType, entityId: item.entityId, metadata: item.metadata },
      context,
    ),
    createdAt: item.createdAt.toISOString(),
    isRead: item.isRead,
    isDismissed: item.isDismissed,
    isPending: item.isPending,
  };
}
