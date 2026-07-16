import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logPlatformAudit } from "@/lib/platform-audit";

// Sprint SST 1.4D, §4 / Sprint SST 1.4D.1, §7-8 — bootstrap operacional do
// Portal Super Admin Lite. Nunca cria credencial fixa no código, nunca cria
// usuário administrativo em seed de produção — o único jeito de alguém
// virar Super Admin é este módulo, chamado manualmente por um operador de
// confiança contra um usuário Better Auth JÁ existente. Usa `logger` (pino
// cru), não `logInfo`/`logWarn` de lib/logger.ts — mesmo motivo documentado
// em lib/auth.ts: essas duas chamam `next/headers()` internamente, e este
// módulo roda como script standalone, fora de qualquer request scope do
// Next.js (`logPlatformAudit` já lida com isso internamente via
// `getRequestContext`, que faz fallback silencioso fora de um request).
//
// Sprint SST 1.4D.1 distingue duas situações, cada uma com seu próprio
// contrato de confirmação (§7):
//   - PRIMEIRO bootstrap (nenhum SUPER_ADMIN ativo existe ainda): exige
//     `--confirm-first-bootstrap` + `--reason=`, `actorUserId` fica null
//     (não existe ninguém que "concedeu"), `source: FIRST_BOOTSTRAP`.
//   - Concessões POSTERIORES (já existe pelo menos um SUPER_ADMIN ativo):
//     exige identificação explícita do administrador responsável
//     (`--granted-by=email`) + `--reason=`; resolve e confirma que esse
//     administrador tem PlatformUser ativo antes de aplicar a concessão.
//     `source: CLI`.
//
// A identificação do ator pelo CLI (`--granted-by=email`) NÃO é
// criptograficamente forte — é só um e-mail informado na linha de comando,
// nunca uma prova de identidade do operador que está de fato digitando o
// comando. Documentado aqui e no relatório da sprint: nunca apresentar este
// campo como prova de quem realmente executou a ação, só como o
// administrador que o operador ALEGA estar representando.

export function parseEmailArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--email="));
  if (!arg) return null;
  const email = arg.slice("--email=".length).trim().toLowerCase();
  return email || null;
}

export function parseArgValue(argv: string[], flag: string): string | null {
  const arg = argv.find((a) => a.startsWith(`--${flag}=`));
  if (!arg) return null;
  const value = arg.slice(`--${flag}=`.length).trim();
  return value || null;
}

export async function hasAnyActiveSuperAdmin(): Promise<boolean> {
  const count = await prisma.platformUser.count({ where: { role: "SUPER_ADMIN", active: true } });
  return count > 0;
}

export type GrantContext =
  | { kind: "FIRST_BOOTSTRAP"; reason: string }
  | { kind: "GRANTED_BY"; grantedByEmail: string; reason: string };

export type GrantResult =
  | { ok: true; created: boolean; reactivated: boolean; platformUserId: string; userId: string; userEmail: string }
  | { ok: false; reason: "USER_NOT_FOUND" }
  | { ok: false; reason: "GRANTER_NOT_FOUND" }
  | { ok: false; reason: "GRANTER_NOT_ACTIVE_SUPER_ADMIN" }
  | { ok: false; reason: "FIRST_BOOTSTRAP_ALREADY_DONE" };

/**
 * Cria (ou reativa) um PlatformUser SUPER_ADMIN para um usuário Better Auth
 * JÁ existente. Idempotente: rodar duas vezes para o mesmo e-mail não cria
 * uma segunda linha nem duplica nada. Nunca cria CompanyMembership, nunca
 * altera User.companyId, nunca altera senha.
 */
export async function grantPlatformAdmin(email: string, context: GrantContext): Promise<GrantResult> {
  const alreadyBootstrapped = await hasAnyActiveSuperAdmin();

  let actorUserId: string | null = null;

  if (context.kind === "FIRST_BOOTSTRAP") {
    if (alreadyBootstrapped) {
      // Já existe pelo menos um SUPER_ADMIN ativo — usar o caminho de
      // "primeiro bootstrap" de novo esconderia quem de fato autorizou esta
      // concessão adicional. Força o caminho GRANTED_BY.
      return { ok: false, reason: "FIRST_BOOTSTRAP_ALREADY_DONE" };
    }
  } else {
    const granter = await prisma.user.findUnique({ where: { email: context.grantedByEmail.trim().toLowerCase() } });
    if (!granter) {
      return { ok: false, reason: "GRANTER_NOT_FOUND" };
    }
    const granterPlatformUser = await prisma.platformUser.findUnique({ where: { userId: granter.id } });
    if (!granterPlatformUser || !granterPlatformUser.active || granterPlatformUser.role !== "SUPER_ADMIN") {
      return { ok: false, reason: "GRANTER_NOT_ACTIVE_SUPER_ADMIN" };
    }
    actorUserId = granter.id;
  }

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    return { ok: false, reason: "USER_NOT_FOUND" };
  }

  const existing = await prisma.platformUser.findUnique({ where: { userId: user.id } });
  const source = context.kind === "FIRST_BOOTSTRAP" ? "FIRST_BOOTSTRAP" : "CLI";
  const action = context.kind === "FIRST_BOOTSTRAP" ? "platform_admin.first_bootstrap" : "platform_admin.access_granted";

  if (!existing) {
    const created = await prisma.platformUser.create({
      data: { userId: user.id, role: "SUPER_ADMIN", active: true },
    });
    logger.info(
      { action, platformUserId: created.id, userId: user.id, role: created.role, created: true },
      "platform_admin_access_granted",
    );
    await logPlatformAudit({
      action,
      severity: "CRITICAL",
      source,
      actorUserId,
      targetType: "PlatformUser",
      targetId: created.id,
      reason: context.reason,
      metadata: { targetUserId: user.id, created: true },
    });
    return { ok: true, created: true, reactivated: false, platformUserId: created.id, userId: user.id, userEmail: user.email };
  }

  if (!existing.active) {
    const reactivated = await prisma.platformUser.update({
      where: { id: existing.id },
      data: { active: true },
    });
    logger.info(
      { action: "platform_admin.access_reactivated", platformUserId: reactivated.id, userId: user.id, role: reactivated.role },
      "platform_admin_access_reactivated",
    );
    await logPlatformAudit({
      action: "platform_admin.access_reactivated",
      severity: "CRITICAL",
      source,
      actorUserId,
      targetType: "PlatformUser",
      targetId: reactivated.id,
      reason: context.reason,
      metadata: { targetUserId: user.id },
    });
    return { ok: true, created: false, reactivated: true, platformUserId: reactivated.id, userId: user.id, userEmail: user.email };
  }

  // Já ativo — idempotente, nenhuma escrita nem evento novo (rodar de novo
  // com os mesmos argumentos nunca duplica um evento persistente).
  return { ok: true, created: false, reactivated: false, platformUserId: existing.id, userId: user.id, userEmail: user.email };
}

export type RevokeOptions = {
  reason: string;
  /** true só quando o operador passou explicitamente a flag extraordinária
   * (`--allow-no-active-super-admin`) E a confirmação adicional
   * (`--confirm-empty-platform`) — ver scripts/platform-admin-revoke.ts. */
  allowNoActiveSuperAdmin?: boolean;
  revokedByEmail?: string;
};

export type RevokeResult =
  | { ok: true; alreadyInactive: boolean; platformUserId: string; userId: string; userEmail: string }
  | { ok: false; reason: "USER_NOT_FOUND" | "PLATFORM_USER_NOT_FOUND" | "LAST_ACTIVE_SUPER_ADMIN" };

/**
 * Revoga (active: false) o acesso de Super Admin de um usuário. Nunca
 * remove silenciosamente o ÚLTIMO SUPER_ADMIN ativo — isso deixaria a
 * plataforma sem ninguém capaz de conceder acesso a mais alguém, um beco
 * sem saída operacional. `allowNoActiveSuperAdmin` é a flag extraordinária e
 * documentada exigida pelo spec para esse caso excepcional — nunca chamada
 * `--force` (nome genérico demais para uma operação desse risco).
 */
export async function revokePlatformAdmin(email: string, options: RevokeOptions): Promise<RevokeResult> {
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

  let revokedByUserId: string | null = null;
  if (options.revokedByEmail) {
    const revoker = await prisma.user.findUnique({ where: { email: options.revokedByEmail.trim().toLowerCase() } });
    if (revoker) revokedByUserId = revoker.id;
  }

  if (existing.role === "SUPER_ADMIN" && !options.allowNoActiveSuperAdmin) {
    const otherActiveSuperAdmins = await prisma.platformUser.count({
      where: { role: "SUPER_ADMIN", active: true, id: { not: existing.id } },
    });
    if (otherActiveSuperAdmins === 0) {
      await logPlatformAudit({
        action: "platform_admin.last_admin_revocation_blocked",
        severity: "WARNING",
        source: "CLI",
        actorUserId: revokedByUserId,
        targetType: "PlatformUser",
        targetId: existing.id,
        reason: options.reason,
        metadata: { targetUserId: user.id },
      });
      return { ok: false, reason: "LAST_ACTIVE_SUPER_ADMIN" };
    }
  }

  const revoked = await prisma.platformUser.update({ where: { id: existing.id }, data: { active: false } });
  logger.info(
    { action: "platform_admin.access_revoked", platformUserId: revoked.id, userId: user.id, extraordinary: Boolean(options.allowNoActiveSuperAdmin) },
    "platform_admin_access_revoked",
  );
  await logPlatformAudit({
    action: "platform_admin.access_revoked",
    severity: "CRITICAL",
    source: "CLI",
    actorUserId: revokedByUserId,
    targetType: "PlatformUser",
    targetId: revoked.id,
    reason: options.reason,
    metadata: { targetUserId: user.id, extraordinary: Boolean(options.allowNoActiveSuperAdmin) },
  });
  return { ok: true, alreadyInactive: false, platformUserId: revoked.id, userId: user.id, userEmail: user.email };
}
