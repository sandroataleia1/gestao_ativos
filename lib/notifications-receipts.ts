import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";
import { isNotificationVisibleInScope, scopeWhere, type NotificationScope } from "@/lib/notifications-listing";

// Sprint SST 1.4E, §16-§18 — leitura/dispensa são SEMPRE individuais
// (NotificationReceipt), nunca resolvem a notificação globalmente. Toda
// mutação revalida visibilidade primeiro (§15: "para notificação invisível,
// preferir 404 sem revelar existência") — nunca basta conhecer o
// `notificationId`.

/** Marca uma notificação como lida para o usuário atual — idempotente (uma
 * segunda chamada sobre uma já lida é um no-op real, nunca reescreve
 * `readAt`). Nunca altera `audience`/`resolvedAt` (a notificação em si é
 * imutável aqui — só o receipt individual muda). */
export async function markNotificationRead(userId: string, notificationId: string, scope: NotificationScope): Promise<void> {
  const visible = await isNotificationVisibleInScope(notificationId, scope);
  if (!visible) throw new NotFoundError("Notificação não encontrada.");

  const existing = await prisma.notificationReceipt.findUnique({
    where: { notificationId_userId: { notificationId, userId } },
  });
  if (existing?.readAt) return;

  await prisma.notificationReceipt.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId, readAt: new Date() },
    update: { readAt: new Date() },
  });
}

/** Marca como lidas TODAS as notificações visíveis no escopo atual (§17) —
 * nunca uma query por notificação: 1 select (ids visíveis) + 1 createMany
 * (receipts que ainda não existem) + 1 updateMany (readAt das que faltam).
 * Nunca toca notificações de outro escopo (outra Company/provider/audiência)
 * nem as já dispensadas. */
export async function markAllNotificationsRead(userId: string, scope: NotificationScope): Promise<number> {
  const visible = await prisma.notification.findMany({
    where: {
      ...scopeWhere(scope),
      receipts: { none: { userId, dismissedAt: { not: null } } },
    },
    select: { id: true },
  });
  if (visible.length === 0) return 0;

  const now = new Date();
  // Cria os receipts que ainda não existem SEM `readAt` (nulo por default)
  // — o `updateMany` abaixo é quem realmente marca como lida e conta
  // corretamente quantas linhas mudaram. Definir `readAt` já aqui faria o
  // `updateMany` seguinte não encontrar essas linhas (já não estariam mais
  // `readAt: null`) e o `count` retornado subestimaria o total.
  await prisma.notificationReceipt.createMany({
    data: visible.map((n) => ({ notificationId: n.id, userId })),
    skipDuplicates: true,
  });
  const { count } = await prisma.notificationReceipt.updateMany({
    where: { userId, notificationId: { in: visible.map((n) => n.id) }, readAt: null },
    data: { readAt: now },
  });
  return count;
}

/** Dispensa (oculta individualmente) uma notificação — nunca resolve
 * globalmente, nunca apaga, nunca afeta outro usuário. */
export async function dismissNotification(userId: string, notificationId: string, scope: NotificationScope): Promise<void> {
  const visible = await isNotificationVisibleInScope(notificationId, scope);
  if (!visible) throw new NotFoundError("Notificação não encontrada.");

  await prisma.notificationReceipt.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId, dismissedAt: new Date() },
    update: { dismissedAt: new Date() },
  });
}
