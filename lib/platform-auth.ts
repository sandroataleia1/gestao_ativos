import { forbidden, unauthorized } from "next/navigation";

import { AuthError, ForbiddenError, requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { logPlatformAudit } from "@/lib/platform-audit";
import type { PlatformUserRole } from "@/app/generated/prisma/client";

// Sprint SST 1.4D — autorização do Portal Super Admin Lite (/platform-admin
// e /api/platform-admin/**), módulo deliberadamente separado de
// lib/auth-server.ts (RBAC do Portal Empresa) e lib/sst-auth.ts (RBAC do
// Portal Consultoria) — mesmo padrão dos dois. O "tenant" deste portal não
// é nenhuma Company nem SstProvider: é a PLATAFORMA inteira. Reaproveita só
// requireAuth() (resolução de identidade — sessão Better Auth, comum a todo
// o app) e as classes AuthError/ForbiddenError (para handleApiError
// continuar funcionando sem mudança). NUNCA usa CompanyMembership,
// User.companyId, active_company_id ou SstProviderUser como autoridade —
// autorização vem exclusivamente de PlatformUser.active === true.

export async function getCurrentPlatformUser() {
  const user = await requireAuth();
  const platformUser = await prisma.platformUser.findFirst({
    where: { userId: user.id, active: true },
  });
  return { user, platformUser };
}

/**
 * Garante sessão autenticada + PlatformUser ativo — nunca aceita
 * `platformUserId`/`role` vindos do client, sempre resolvido da sessão.
 * `PlatformUser.active === false` bloqueia imediatamente, na PRÓXIMA
 * requisição (mesmo padrão de CompanyMembership.status/SstProvider.active
 * já usado em todo o projeto) — nunca depende de logout.
 */
// Sprint SST 1.4D.1, §5-6 — dedup de `platform_admin.unauthorized_access_attempt`:
// este guard roda em TODA requisição a /platform-admin/**, então sem
// deduplicação um usuário sem acesso navegando normalmente (ou um script
// automatizado insistindo) geraria milhares de linhas. Mesmo padrão de
// `recordClaimViewed` (lib/platform-admin-claims.ts): só persiste um novo
// evento se o último, do MESMO usuário, tiver mais de 5 minutos.
const UNAUTHORIZED_ATTEMPT_DEDUPE_WINDOW_MS = 5 * 60_000;

async function recordUnauthorizedAccessAttempt(userId: string): Promise<void> {
  const last = await prisma.platformAuditLog.findFirst({
    where: { action: "platform_admin.unauthorized_access_attempt", actorUserId: userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() - last.createdAt.getTime() < UNAUTHORIZED_ATTEMPT_DEDUPE_WINDOW_MS) {
    return;
  }
  await logPlatformAudit({
    action: "platform_admin.unauthorized_access_attempt",
    severity: "WARNING",
    source: "WEB",
    actorUserId: userId,
    targetType: "PlatformUser",
  }).catch(() => {});
}

export async function requirePlatformUser() {
  const user = await requireAuth();
  const platformUser = await prisma.platformUser.findFirst({
    where: { userId: user.id, active: true },
  });
  if (!platformUser) {
    // Sem companyId natural (a tentativa não é sobre nenhuma Company
    // específica) — log estruturado (pino, via lib/logger.ts) SEMPRE, mais
    // um registro persistente em PlatformAuditLog (deduplicado — ver
    // acima). Nunca expõe detalhes internos na resposta — só o
    // ForbiddenError genérico abaixo.
    logWarn("platform_admin_unauthorized_access_attempt", { userId: user.id });
    await recordUnauthorizedAccessAttempt(user.id);
    throw new ForbiddenError("Este usuário não possui acesso ao Portal Super Admin.");
  }
  return { user, platformUser };
}

export async function requirePlatformRole(role: PlatformUserRole) {
  const ctx = await requirePlatformUser();
  if (ctx.platformUser.role !== role) {
    throw new ForbiddenError(`Papel "${role}" é necessário para esta ação.`);
  }
  return ctx;
}

// --- Variantes para uso direto em Server Components (páginas /platform-admin/*) ---
// Mesmo padrão de requireAuthOrDeny/requireSstAuthOrDeny — usando os
// boundaries app/platform-admin/unauthorized.tsx e
// app/platform-admin/forbidden.tsx (mais próximos da rota que os da raiz).

export async function requirePlatformUserOrDeny() {
  try {
    return await requirePlatformUser();
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requirePlatformRoleOrDeny(role: PlatformUserRole) {
  try {
    return await requirePlatformRole(role);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
