import type { SstProviderUserRole } from "@/app/generated/prisma/client";
import { companyVisibleTypes, type NotificationScope } from "@/lib/notifications-listing";
import { typesForAudience, sstTypesVisibleToRole } from "@/lib/notifications-visibility";

// Sprint SST 1.4E — monta o `NotificationScope` (lib/notifications-listing.ts)
// para as rotas de mutação (read/read-all/dismiss) de cada portal. Sempre a
// partir de identidade já resolvida pelo guard do portal (companyId de
// `requireCompany()`, sstProviderId/role de `requireSstAuth()`, PlatformUser
// ativo de `requirePlatformRole()`) — nunca de um valor vindo do body/query.

export function companyNotificationScope(companyId: string, hasManagePermission: boolean): NotificationScope {
  return { audience: "COMPANY", companyId, visibleTypes: companyVisibleTypes(hasManagePermission) };
}

export function sstNotificationScope(sstProviderId: string, role: SstProviderUserRole): NotificationScope {
  return { audience: "SST_PROVIDER", sstProviderId, visibleTypes: sstTypesVisibleToRole(role) };
}

export function platformNotificationScope(): NotificationScope {
  return { audience: "PLATFORM", visibleTypes: typesForAudience("PLATFORM") };
}
