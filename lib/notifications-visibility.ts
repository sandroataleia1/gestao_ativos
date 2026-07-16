import type { NotificationAudience, NotificationSeverity, NotificationType, SstProviderUserRole } from "@/app/generated/prisma/client";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";

// Sprint SST 1.4E, §7 — política central de visibilidade. Nunca armazenar
// permissão livre enviada pelo client: cada NotificationType tem uma
// política FIXA, definida em código, consultada com o papel/permissão
// ATUAIS do usuário a cada requisição — nunca um valor congelado no
// momento da criação da notificação (§8: "resolução dinâmica da
// audiência").

/**
 * Como a notificação conta para o badge/contador "pendente":
 *   - RESOLUTION: pendente enquanto `Notification.resolvedAt` for null —
 *     evento que EXIGE uma decisão de alguém (aprovar/rejeitar/decidir
 *     disputa). Global: uma vez resolvido, para de contar para TODOS.
 *   - READ: pendente enquanto o RECEIPT do usuário atual não tiver
 *     `readAt` — evento informativo, que não precisa de nenhuma decisão
 *     (ex.: "acesso aprovado"), só precisa ser lido. Individual por usuário.
 */
export type PendingSignal = "RESOLUTION" | "READ";

export type NotificationVisibilityPolicy = {
  audience: NotificationAudience;
  severity: NotificationSeverity;
  /** Aparece no popover do sino (enquanto pendente, ver `pendingVia`). */
  appearsInBell: boolean;
  /** Aparece na página completa (`/notifications`, `/sst/notifications`, `/platform-admin/notifications`). */
  appearsInHistory: boolean;
  /** Continua visível (na página completa) depois de resolvida — nunca some do histórico. */
  remainsVisibleAfterResolution: boolean;
  pendingVia: PendingSignal;
  /** Só para audience COMPANY — exige contexto de empresa ativa resolvido. */
  requiresActiveCompanyContext: boolean;
  /** Só para audience COMPANY — permissão exigida além de CompanyMembership ACTIVE. */
  requiredCompanyPermission?: PermissionKey;
  /** Só para audience SST_PROVIDER — quais papéis enxergam este tipo. */
  sstRolesAllowed?: readonly SstProviderUserRole[];
  /** actionKey default deste tipo (lib/notification-action.ts pode ainda decidir omitir a ação conforme o estado atual). */
  defaultActionKey: string | null;
};

const SST_ALL_ROLES: readonly SstProviderUserRole[] = ["OWNER", "TECHNICIAN", "VIEWER"];
const SST_OWNER_TECHNICIAN: readonly SstProviderUserRole[] = ["OWNER", "TECHNICIAN"];
const SST_OWNER_ONLY: readonly SstProviderUserRole[] = ["OWNER"];

const POLICIES: Record<NotificationType, NotificationVisibilityPolicy> = {
  COMPANY_SST_ACCESS_REQUESTED: {
    audience: "COMPANY",
    severity: "WARNING",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "RESOLUTION",
    requiresActiveCompanyContext: true,
    requiredCompanyPermission: PERMISSIONS.SST_PROVIDER_MANAGE,
    defaultActionKey: "COMPANY_REVIEW_SST_ACCESS",
  },
  COMPANY_SST_ACCESS_REQUEST_RESOLVED: {
    audience: "COMPANY",
    severity: "INFO",
    // Nunca mantém badge pendente (§4) — histórica desde o nascimento.
    appearsInBell: false,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: true,
    requiredCompanyPermission: PERMISSIONS.SST_PROVIDER_MANAGE,
    defaultActionKey: null,
  },

  SST_ACCESS_APPROVED: {
    audience: "SST_PROVIDER",
    severity: "SUCCESS",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_ALL_ROLES,
    defaultActionKey: "SST_OPEN_COMPANY",
  },
  SST_ACCESS_REJECTED: {
    audience: "SST_PROVIDER",
    severity: "WARNING",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    // Só OWNER (o único que solicitou/decide sobre novos pedidos de acesso).
    sstRolesAllowed: SST_OWNER_ONLY,
    defaultActionKey: "SST_VIEW_RELATIONSHIP",
  },
  SST_ACCESS_SUSPENDED: {
    audience: "SST_PROVIDER",
    severity: "WARNING",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_ALL_ROLES,
    defaultActionKey: "SST_VIEW_RELATIONSHIP",
  },
  SST_ACCESS_REVOKED: {
    audience: "SST_PROVIDER",
    severity: "CRITICAL",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_ALL_ROLES,
    defaultActionKey: "SST_VIEW_RELATIONSHIP",
  },
  SST_ACCESS_LEVEL_CHANGED: {
    audience: "SST_PROVIDER",
    severity: "INFO",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_OWNER_TECHNICIAN,
    defaultActionKey: "SST_OPEN_COMPANY",
  },
  SST_COMPANY_CLAIM_STARTED: {
    audience: "SST_PROVIDER",
    severity: "INFO",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "RESOLUTION",
    requiresActiveCompanyContext: false,
    // Só OWNER — evento sobre a continuidade da autorização, mesmo escopo de SST_ACCESS_REJECTED.
    sstRolesAllowed: SST_OWNER_ONLY,
    defaultActionKey: "SST_VIEW_RELATIONSHIP",
  },
  SST_AUTHORIZATION_CONFIRMED: {
    audience: "SST_PROVIDER",
    severity: "SUCCESS",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_ALL_ROLES,
    defaultActionKey: "SST_OPEN_COMPANY",
  },
  SST_AUTHORIZATION_BLOCKED: {
    audience: "SST_PROVIDER",
    severity: "CRITICAL",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "READ",
    requiresActiveCompanyContext: false,
    sstRolesAllowed: SST_ALL_ROLES,
    defaultActionKey: "SST_VIEW_RELATIONSHIP",
  },

  PLATFORM_COMPANY_CLAIM_REQUESTED: {
    audience: "PLATFORM",
    severity: "INFO",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "RESOLUTION",
    requiresActiveCompanyContext: false,
    defaultActionKey: "PLATFORM_REVIEW_CLAIM",
  },
  PLATFORM_COMPANY_CLAIM_DISPUTED: {
    audience: "PLATFORM",
    severity: "WARNING",
    appearsInBell: true,
    appearsInHistory: true,
    remainsVisibleAfterResolution: true,
    pendingVia: "RESOLUTION",
    requiresActiveCompanyContext: false,
    defaultActionKey: "PLATFORM_REVIEW_DISPUTE",
  },
};

export function getNotificationVisibilityPolicy(type: NotificationType): NotificationVisibilityPolicy {
  return POLICIES[type];
}

export const ALL_NOTIFICATION_TYPES = Object.keys(POLICIES) as NotificationType[];

export function typesForAudience(audience: NotificationAudience): NotificationType[] {
  return ALL_NOTIFICATION_TYPES.filter((type) => POLICIES[type].audience === audience);
}

/** Tipos visíveis a um papel específico do Portal Consultoria — nunca todos
 * os tipos SST_PROVIDER indiscriminadamente (§7: OWNER/TECHNICIAN/VIEWER têm
 * matrizes diferentes). */
export function sstTypesVisibleToRole(role: SstProviderUserRole): NotificationType[] {
  return typesForAudience("SST_PROVIDER").filter((type) => POLICIES[type].sstRolesAllowed?.includes(role));
}
