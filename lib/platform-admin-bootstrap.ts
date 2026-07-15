import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// Sprint SST 1.4D, §4 — bootstrap operacional do Portal Super Admin Lite.
// Nunca cria credencial fixa no código, nunca cria usuário administrativo
// em seed de produção — o único jeito de alguém virar Super Admin é este
// comando, rodado manualmente por um operador de confiança contra um
// usuário Better Auth JÁ existente. Usa `logger` (pino cru), não
// `logInfo`/`logWarn` de lib/logger.ts — mesmo motivo documentado em
// lib/auth.ts: essas duas chamam `next/headers()` internamente, e este
// módulo roda como script standalone, fora de qualquer request scope do
// Next.js.

export function parseEmailArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--email="));
  if (!arg) return null;
  const email = arg.slice("--email=".length).trim().toLowerCase();
  return email || null;
}

export type GrantResult =
  | { ok: true; created: boolean; reactivated: boolean; platformUserId: string; userId: string; userEmail: string }
  | { ok: false; reason: "USER_NOT_FOUND" };

/**
 * Cria (ou reativa) um PlatformUser SUPER_ADMIN para um usuário Better Auth
 * JÁ existente. Idempotente: rodar duas vezes para o mesmo e-mail não cria
 * uma segunda linha nem duplica nada — a segunda chamada só confirma que já
 * está ativo. Nunca cria CompanyMembership, nunca altera User.companyId,
 * nunca altera senha.
 */
export async function grantPlatformAdmin(email: string): Promise<GrantResult> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    return { ok: false, reason: "USER_NOT_FOUND" };
  }

  const existing = await prisma.platformUser.findUnique({ where: { userId: user.id } });

  if (!existing) {
    const created = await prisma.platformUser.create({
      data: { userId: user.id, role: "SUPER_ADMIN", active: true },
    });
    logger.info(
      { action: "platform_admin.access_granted", platformUserId: created.id, userId: user.id, role: created.role, created: true },
      "platform_admin_access_granted",
    );
    return { ok: true, created: true, reactivated: false, platformUserId: created.id, userId: user.id, userEmail: user.email };
  }

  if (!existing.active) {
    const reactivated = await prisma.platformUser.update({
      where: { id: existing.id },
      data: { active: true },
    });
    logger.info(
      { action: "platform_admin.access_granted", platformUserId: reactivated.id, userId: user.id, role: reactivated.role, reactivated: true },
      "platform_admin_access_granted",
    );
    return { ok: true, created: false, reactivated: true, platformUserId: reactivated.id, userId: user.id, userEmail: user.email };
  }

  // Já ativo — idempotente, nenhuma escrita necessária.
  return { ok: true, created: false, reactivated: false, platformUserId: existing.id, userId: user.id, userEmail: user.email };
}

export type RevokeResult =
  | { ok: true; alreadyInactive: boolean; platformUserId: string; userId: string; userEmail: string }
  | { ok: false; reason: "USER_NOT_FOUND" | "PLATFORM_USER_NOT_FOUND" | "LAST_ACTIVE_SUPER_ADMIN" };

/**
 * Revoga (active: false) o acesso de Super Admin de um usuário. Nunca
 * remove silenciosamente o ÚLTIMO SUPER_ADMIN ativo — isso deixaria a
 * plataforma sem ninguém capaz de conceder acesso a mais alguém, um
 * beco sem saída operacional. `force` é a flag extraordinária e
 * documentada exigida pelo spec para esse caso excepcional.
 */
export async function revokePlatformAdmin(email: string, options: { force?: boolean } = {}): Promise<RevokeResult> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    return { ok: false, reason: "USER_NOT_FOUND" };
  }

  const existing = await prisma.platformUser.findUnique({ where: { userId: user.id } });
  if (!existing) {
    return { ok: false, reason: "PLATFORM_USER_NOT_FOUND" };
  }
  if (!existing.active) {
    return { ok: true, alreadyInactive: true, platformUserId: existing.id, userId: user.id, userEmail: user.email };
  }

  if (existing.role === "SUPER_ADMIN" && !options.force) {
    const otherActiveSuperAdmins = await prisma.platformUser.count({
      where: { role: "SUPER_ADMIN", active: true, id: { not: existing.id } },
    });
    if (otherActiveSuperAdmins === 0) {
      return { ok: false, reason: "LAST_ACTIVE_SUPER_ADMIN" };
    }
  }

  const revoked = await prisma.platformUser.update({ where: { id: existing.id }, data: { active: false } });
  logger.info(
    { action: "platform_admin.access_revoked", platformUserId: revoked.id, userId: user.id, forced: Boolean(options.force) },
    "platform_admin_access_revoked",
  );
  return { ok: true, alreadyInactive: false, platformUserId: revoked.id, userId: user.id, userEmail: user.email };
}
