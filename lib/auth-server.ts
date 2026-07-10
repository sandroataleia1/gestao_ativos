import { cache } from "react";
import { headers } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PermissionKey, SystemRole } from "@/lib/permissions";

// `next/headers` só pode ser importado em Server Components/Route Handlers,
// então este módulo é implicitamente server-only.

export class AuthError extends Error {
  constructor(message = "Não autenticado.") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Acesso negado.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Lê a sessão atual a partir dos cookies da requisição. Memoizado por
 * requisição (React `cache`) para evitar múltiplas idas ao banco quando
 * vários helpers são chamados na mesma renderização.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function getCurrentUser() {
  const session = await getSession();
  const user = session?.user ?? null;
  // Usuário bloqueado (ver app/(app)/configuracoes/usuarios) perde acesso a
  // partir da próxima requisição — tratado como se não houvesse sessão,
  // sem precisar revogar a sessão manualmente em cada bloqueio.
  if (user && (user as { active?: boolean }).active === false) return null;
  return user;
}

/**
 * Deriva a empresa (tenant) do usuário autenticado a partir da sessão —
 * nunca de um parâmetro vindo do client. Toda query de dados de negócio deve
 * usar o `companyId` retornado aqui (ou por `requireCompany`).
 */
export async function getCurrentCompany() {
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.company.findUnique({ where: { id: user.companyId } });
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

/**
 * Garante usuário autenticado e retorna `companyId` já resolvido da sessão,
 * pronto para ser usado em `where: { companyId }` nas queries Prisma.
 */
export async function requireCompany() {
  const user = await requireAuth();
  return { user, companyId: user.companyId };
}

export async function requireRole(role: SystemRole | (string & {})) {
  const { user, companyId } = await requireCompany();
  const assignment = await prisma.userRole.findFirst({
    where: { userId: user.id, companyId, role: { name: role } },
    select: { id: true },
  });
  if (!assignment) {
    throw new ForbiddenError(`Papel "${role}" é necessário para esta ação.`);
  }
  return { user, companyId };
}

export async function requirePermission(permission: PermissionKey | (string & {})) {
  const { user, companyId } = await requireCompany();
  const assignment = await prisma.userRole.findFirst({
    where: {
      userId: user.id,
      companyId,
      role: { permissions: { some: { permission: { key: permission } } } },
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new ForbiddenError(`Permissão "${permission}" é necessária para esta ação.`);
  }
  return { user, companyId };
}

/**
 * Variante não-lançável de `requirePermission`, para decisões de UI (ex.:
 * esconder um botão "Novo" para quem não tem permissão de gestão) sem
 * interromper a renderização da página.
 */
export async function hasPermission(permission: PermissionKey | (string & {})) {
  try {
    await requirePermission(permission);
    return true;
  } catch (error) {
    if (error instanceof AuthError || error instanceof ForbiddenError) return false;
    throw error;
  }
}

// --- Variantes para uso direto em Server Components (páginas) ---
//
// `requireAuth`/`requirePermission`/`requireRole` lançam AuthError/
// ForbiddenError, o que é o formato certo para Route Handlers (capturado por
// `handleApiError` e convertido em JSON 401/403). Numa página, uma exceção
// não tratada vira um crash genérico (500). As variantes abaixo capturam o
// mesmo erro e chamam `unauthorized()`/`forbidden()` do Next.js, que
// renderizam `app/unauthorized.tsx`/`app/forbidden.tsx` com o status HTTP
// correto (401/403) em vez de quebrar a página.

export async function requireAuthOrDeny() {
  try {
    return await requireAuth();
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    throw error;
  }
}

export async function requirePermissionOrDeny(permission: PermissionKey | (string & {})) {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requireRoleOrDeny(role: SystemRole | (string & {})) {
  try {
    return await requireRole(role);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
