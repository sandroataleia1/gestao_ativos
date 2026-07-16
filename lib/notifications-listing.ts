import type { NotificationType, SstProviderUserRole } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getNotificationVisibilityPolicy, typesForAudience, sstTypesVisibleToRole } from "@/lib/notifications-visibility";

// Sprint SST 1.4E, §8/§28 — leitura de notificações. Visibilidade resolvida
// a cada consulta a partir do papel/permissão ATUAIS (nunca um snapshot
// congelado) — nenhuma cópia física por destinatário, só
// `NotificationReceipt` sob demanda. Evita N+1: o `include` de receipts é
// filtrado pelo usuário atual (1 JOIN, não 1 query por notificação).

export type NotificationListItem = {
  id: string;
  type: NotificationType;
  severity: string;
  title: string;
  message: string;
  actionKey: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  isRead: boolean;
  isDismissed: boolean;
  isPending: boolean;
};

const BELL_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 20;

function resolutionTypes(types: NotificationType[]): NotificationType[] {
  return types.filter((t) => getNotificationVisibilityPolicy(t).pendingVia === "RESOLUTION");
}
function readTypes(types: NotificationType[]): NotificationType[] {
  return types.filter((t) => getNotificationVisibilityPolicy(t).pendingVia === "READ");
}

function toListItem(
  row: {
    id: string;
    type: NotificationType;
    severity: string;
    title: string;
    message: string;
    actionKey: string | null;
    entityType: string | null;
    entityId: string | null;
    metadata: unknown;
    createdAt: Date;
    resolvedAt: Date | null;
    receipts: { readAt: Date | null; dismissedAt: Date | null }[];
  },
): NotificationListItem {
  const receipt = row.receipts[0];
  const isRead = Boolean(receipt?.readAt);
  const isDismissed = Boolean(receipt?.dismissedAt);
  const policy = getNotificationVisibilityPolicy(row.type);
  const isPending = policy.pendingVia === "RESOLUTION" ? row.resolvedAt === null : !isRead;
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    actionKey: row.actionKey,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    isRead,
    isDismissed,
    isPending,
  };
}

type Scope =
  | { audience: "COMPANY"; companyId: string; visibleTypes: NotificationType[] }
  | { audience: "SST_PROVIDER"; sstProviderId: string; visibleTypes: NotificationType[] }
  | { audience: "PLATFORM"; visibleTypes: NotificationType[] };

export function scopeWhere(scope: Scope) {
  if (scope.audience === "COMPANY") {
    return { audience: "COMPANY" as const, companyId: scope.companyId, type: { in: scope.visibleTypes } };
  }
  if (scope.audience === "SST_PROVIDER") {
    return { audience: "SST_PROVIDER" as const, sstProviderId: scope.sstProviderId, type: { in: scope.visibleTypes } };
  }
  return { audience: "PLATFORM" as const, type: { in: scope.visibleTypes } };
}

async function bell(userId: string, scope: Scope): Promise<NotificationListItem[]> {
  const where = scopeWhere(scope);
  const rows = await prisma.notification.findMany({
    where: {
      ...where,
      // Nunca mostra dispensada no popover (§18/§19) — mas "Todas" continua mostrando.
      receipts: { none: { userId, dismissedAt: { not: null } } },
    },
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      message: true,
      actionKey: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      resolvedAt: true,
      receipts: { where: { userId }, select: { readAt: true, dismissedAt: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: BELL_LIMIT,
  });
  return rows.map(toListItem);
}

async function unreadCount(userId: string, scope: Scope): Promise<number> {
  const where = scopeWhere(scope);
  const resTypes = resolutionTypes(scope.visibleTypes);
  const rdTypes = readTypes(scope.visibleTypes);

  const [resolutionPending, readPending] = await Promise.all([
    resTypes.length === 0
      ? 0
      : prisma.notification.count({
          where: {
            ...where,
            type: { in: resTypes },
            resolvedAt: null,
            receipts: { none: { userId, dismissedAt: { not: null } } },
          },
        }),
    rdTypes.length === 0
      ? 0
      : prisma.notification.count({
          where: {
            ...where,
            type: { in: rdTypes },
            AND: [
              { NOT: { receipts: { some: { userId, readAt: { not: null } } } } },
              { receipts: { none: { userId, dismissedAt: { not: null } } } },
            ],
          },
        }),
  ]);
  return resolutionPending + readPending;
}

export type NotificationPageFilter = "ALL" | "UNREAD" | NotificationType;

export type NotificationPageResult = {
  items: NotificationListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

async function page(
  userId: string,
  scope: Scope,
  params: { filter?: NotificationPageFilter; types?: NotificationType[]; page?: number; pageSize?: number },
): Promise<NotificationPageResult> {
  const pageNum = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  const where = scopeWhere(scope);

  // `types` (categoria da aba, ex.: "Acessos"/"Empresas" no Portal
  // Consultoria) tem prioridade sobre `filter` de tipo único — nunca
  // combinados na mesma consulta (a UI só manda um ou outro).
  const filterWhere = params.types?.length
    ? { type: { in: params.types } }
    : params.filter && params.filter !== "ALL" && params.filter !== "UNREAD"
      ? { type: params.filter }
      : {};

  const baseWhere = { ...where, ...filterWhere };

  // "UNREAD" precisa ser resolvido em memória (a definição de "pendente"
  // varia por tipo — RESOLUTION vs READ, ver toList Item) para a página
  // completa; para o volume esperado desta sprint (sem histórico retroativo,
  // ver §29) isso é aceitável. A listagem em si continua paginada no banco.
  const [totalCount, rows] = await Promise.all([
    prisma.notification.count({ where: baseWhere }),
    prisma.notification.findMany({
      where: baseWhere,
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        message: true,
        actionKey: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        resolvedAt: true,
        receipts: { where: { userId }, select: { readAt: true, dismissedAt: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  let items = rows.map(toListItem);
  if (params.filter === "UNREAD") {
    items = items.filter((i) => i.isPending);
  }

  return { items, totalCount, page: pageNum, pageSize };
}

// --- Portal Empresa -----------------------------------------------------

export function companyVisibleTypes(hasManagePermission: boolean): NotificationType[] {
  return typesForAudience("COMPANY").filter((type) => {
    const policy = getNotificationVisibilityPolicy(type);
    return !policy.requiredCompanyPermission || hasManagePermission;
  });
}

export async function listCompanyNotificationsForBell(params: { userId: string; companyId: string; hasManagePermission: boolean }) {
  return bell(params.userId, { audience: "COMPANY", companyId: params.companyId, visibleTypes: companyVisibleTypes(params.hasManagePermission) });
}

export async function countCompanyUnreadNotifications(params: { userId: string; companyId: string; hasManagePermission: boolean }) {
  return unreadCount(params.userId, { audience: "COMPANY", companyId: params.companyId, visibleTypes: companyVisibleTypes(params.hasManagePermission) });
}

export async function listCompanyNotificationsPage(
  params: { userId: string; companyId: string; hasManagePermission: boolean } & {
    filter?: NotificationPageFilter;
    types?: NotificationType[];
    page?: number;
    pageSize?: number;
  },
) {
  return page(params.userId, { audience: "COMPANY", companyId: params.companyId, visibleTypes: companyVisibleTypes(params.hasManagePermission) }, params);
}

// --- Portal Consultoria SST ----------------------------------------------

export async function listSstNotificationsForBell(params: { userId: string; sstProviderId: string; role: SstProviderUserRole }) {
  return bell(params.userId, { audience: "SST_PROVIDER", sstProviderId: params.sstProviderId, visibleTypes: sstTypesVisibleToRole(params.role) });
}

export async function countSstUnreadNotifications(params: { userId: string; sstProviderId: string; role: SstProviderUserRole }) {
  return unreadCount(params.userId, { audience: "SST_PROVIDER", sstProviderId: params.sstProviderId, visibleTypes: sstTypesVisibleToRole(params.role) });
}

export async function listSstNotificationsPage(
  params: { userId: string; sstProviderId: string; role: SstProviderUserRole } & {
    filter?: NotificationPageFilter;
    types?: NotificationType[];
    page?: number;
    pageSize?: number;
  },
) {
  return page(params.userId, { audience: "SST_PROVIDER", sstProviderId: params.sstProviderId, visibleTypes: sstTypesVisibleToRole(params.role) }, params);
}

// --- Portal Super Admin ---------------------------------------------------

export async function listPlatformNotificationsForBell(params: { userId: string }) {
  return bell(params.userId, { audience: "PLATFORM", visibleTypes: typesForAudience("PLATFORM") });
}

export async function countPlatformUnreadNotifications(params: { userId: string }) {
  return unreadCount(params.userId, { audience: "PLATFORM", visibleTypes: typesForAudience("PLATFORM") });
}

export async function listPlatformNotificationsPage(
  params: { userId: string } & { filter?: NotificationPageFilter; types?: NotificationType[]; page?: number; pageSize?: number },
) {
  return page(params.userId, { audience: "PLATFORM", visibleTypes: typesForAudience("PLATFORM") }, params);
}

/** Usada pelas rotas de mutação (read/dismiss) para confirmar que uma
 * notificação é visível ao usuário atual ANTES de agir sobre ela — nunca
 * basta conhecer o `notificationId` (§15: "para notificação invisível,
 * preferir 404 sem revelar existência"). */
export async function isNotificationVisibleInScope(notificationId: string, scope: Scope): Promise<boolean> {
  const where = scopeWhere(scope);
  const count = await prisma.notification.count({ where: { id: notificationId, ...where } });
  return count > 0;
}

export type { Scope as NotificationScope };
