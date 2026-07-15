import { cache } from "react";
import { headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { PermissionKey, SystemRole } from "@/lib/permissions";
import { resolveCompanyContext, type CompanyContextSource } from "@/lib/company-context";
import { getRequestedCompanyId } from "@/lib/company-context-request";
import { logInfo, logWarn } from "@/lib/logger";

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
 * Erro distinguível para o status `SELECTION_REQUIRED` do resolver — Sprint
 * 0.6, Parte D. Nunca deve ser tratado como um `ForbiddenError` genérico:
 * páginas redirecionam para `/select-company`; APIs devolvem 409 com
 * `{ code: "COMPANY_SELECTION_REQUIRED" }` (ver lib/api-errors.ts).
 */
export class CompanySelectionRequiredError extends Error {
  activeMembershipCount: number;
  constructor(activeMembershipCount: number) {
    super("Mais de uma empresa disponível — selecione qual empresa usar.");
    this.name = "CompanySelectionRequiredError";
    this.activeMembershipCount = activeMembershipCount;
  }
}

/**
 * Erro distinguível para um usuário autenticado, sem nenhuma
 * CompanyMembership ACTIVE, mas com uma CompanyClaimRequest PENDING/
 * UNDER_REVIEW em aberto (Sprint SST 1.4C, §11) — nunca deve ser tratado
 * como o ForbiddenError genérico de "nenhuma empresa vinculada": páginas
 * redirecionam para /company-claim/pending (nunca para dentro do Portal
 * Empresa); APIs devolvem 403 com `{ code: "CLAIM_PENDING" }` (ver
 * lib/api-errors.ts). Carrega só o id da solicitação — nunca dados da
 * Company (nome/CNPJ ficam por conta da própria página, que já está
 * autorizada a lê-los para O DONO da solicitação).
 */
export class CompanyClaimPendingError extends Error {
  claimRequestId: string;
  constructor(claimRequestId: string) {
    super("Existe uma solicitação de reivindicação em análise para este usuário.");
    this.name = "CompanyClaimPendingError";
    this.claimRequestId = claimRequestId;
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
 * Deriva a empresa (tenant) para exibição — nunca de um parâmetro vindo do
 * client. Aceita opcionalmente um `companyId` já resolvido (por
 * `requireCompany()`/`requirePermission()`) — prefira sempre passá-lo
 * explicitamente a partir da Sprint 0.5, já que o contexto ativo pode
 * divergir de `User.companyId` (segunda empresa via cookie, membership
 * legada revogada com fallback para outra). Sem argumento, cai no
 * comportamento legado (`User.companyId` cru) só por compatibilidade de
 * chamadores que ainda não foram migrados.
 */
export async function getCurrentCompany(companyId?: string) {
  if (companyId) {
    return prisma.company.findUnique({ where: { id: companyId } });
  }
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
 * Garante usuário autenticado e resolve a empresa (tenant) a partir de
 * `CompanyMembership` — a fonte real de autorização a partir da Sprint 0.5
 * (ver docs/adr/ADR-001). `User.companyId` é usado só como preferência
 * legada (`legacyCompanyId`) dentro do resolver central
 * (`lib/company-context.ts`); nunca concede acesso sozinho. O contexto
 * solicitado (cookie `active_company_id`) é lido via
 * `lib/company-context-request.ts` — nunca diretamente aqui nem dentro do
 * resolver.
 *
 * Retorno compatível com o formato anterior (`{ user, companyId }`) — os
 * dois campos novos (`membershipId`, `contextSource`) são aditivos; nenhuma
 * rota existente precisa mudar para continuar funcionando.
 */
export async function requireCompany(): Promise<{
  user: Awaited<ReturnType<typeof requireAuth>>;
  companyId: string;
  membershipId: string;
  contextSource: CompanyContextSource;
}> {
  const user = await requireAuth();
  const requestedCompanyId = await getRequestedCompanyId();

  const result = await resolveCompanyContext({
    userId: user.id,
    legacyCompanyId: user.companyId,
    requestedCompanyId,
  });

  if (result.status === "RESOLVED") {
    if (result.source === "LEGACY") {
      logInfo("company_context_resolved_legacy", { userId: user.id, companyId: result.companyId });
    } else if (result.source === "ONLY_ACTIVE_MEMBERSHIP") {
      logInfo("company_context_resolved_only_active_membership", {
        userId: user.id,
        companyId: result.companyId,
      });
    }
    // Divergência entre a preferência legada e o contexto resolvido — sinal
    // de que o usuário está operando fora da empresa "de origem" (segunda
    // membership via cookie, ou a legada foi revogada e caiu no fallback).
    if (user.companyId && user.companyId !== result.companyId) {
      logWarn("company_context_diverges_from_legacy", {
        userId: user.id,
        legacyCompanyId: user.companyId,
        resolvedCompanyId: result.companyId,
        source: result.source,
      });
    }
    return { user, companyId: result.companyId, membershipId: result.membershipId, contextSource: result.source };
  }

  if (result.status === "INVALID_REQUESTED_CONTEXT") {
    logWarn("company_context_invalid_requested", { userId: user.id });
    throw new ForbiddenError("Contexto de empresa inválido.");
  }

  if (result.status === "SELECTION_REQUIRED") {
    logInfo("company_context_selection_required", {
      userId: user.id,
      activeMembershipCount: result.activeMembershipCount,
    });
    throw new CompanySelectionRequiredError(result.activeMembershipCount);
  }

  if (result.status === "COMPANY_UNAVAILABLE") {
    logWarn("company_context_company_unavailable", { userId: user.id, reason: result.reason });
    throw new ForbiddenError("Esta empresa não está disponível no momento.");
  }

  // NO_ACTIVE_MEMBERSHIP — nunca recria membership aqui; o backfill é
  // responsabilidade exclusiva do script versionado (scripts/backfill-
  // company-memberships.ts), nunca do caminho de requisição (ver Sprint 0.5,
  // Parte I).
  //
  // Sprint SST 1.4C, §11 — antes de cair no ForbiddenError genérico,
  // diferencia "sem empresa E sem solicitação" de "sem empresa MAS com uma
  // CompanyClaimRequest em aberto" (ver lib/company-claim-request.ts). Um
  // usuário com claim pendente nunca deve ver app/forbidden.tsx nem entrar
  // em loop — vai para /company-claim/pending. Consulta inline (não importa
  // lib/company-claim-request.ts) para evitar import circular: esse módulo
  // importa de lib/api-errors.ts, que por sua vez importa deste arquivo.
  const activeClaim = await prisma.companyClaimRequest.findFirst({
    where: { requesterUserId: user.id, status: { in: ["PENDING", "UNDER_REVIEW"] } },
    orderBy: { requestedAt: "desc" },
    select: { id: true },
  });
  if (activeClaim) {
    logInfo("company_context_claim_pending", { userId: user.id, claimRequestId: activeClaim.id });
    throw new CompanyClaimPendingError(activeClaim.id);
  }

  logWarn("company_context_no_active_membership", { userId: user.id });
  throw new ForbiddenError("Nenhuma empresa ativa vinculada a este usuário.");
}

/**
 * Query compartilhada por `requireRole`/`requirePermission` — garante
 * simultaneamente (Sprint 0.5, Parte E):
 *   1. existe uma `CompanyMembership` ACTIVE do usuário para `companyId`;
 *   2/3. a `UserRole` pertence ao mesmo `userId` e ao mesmo `companyId`
 *      resolvido;
 *   4. `Role.companyId` também é igual ao `companyId` resolvido;
 *   5. o filtro adicional (nome do papel ou permissão) bate.
 * Sem FK entre `UserRole` e `CompanyMembership` (ADR-001, §3) — o vínculo é
 * garantido aqui, em código, a cada checagem, nunca pelo banco.
 */
async function findAuthorizedUserRole(
  userId: string,
  companyId: string,
  extraRoleWhere: Prisma.RoleWhereInput = {},
) {
  const activeMembership = await prisma.companyMembership.findFirst({
    where: { userId, companyId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!activeMembership) return null;

  return prisma.userRole.findFirst({
    where: {
      userId,
      companyId,
      role: { companyId, ...extraRoleWhere },
    },
    select: { id: true },
  });
}

export async function requireRole(role: SystemRole | (string & {})) {
  const ctx = await requireCompany();
  const assignment = await findAuthorizedUserRole(ctx.user.id, ctx.companyId, { name: role });
  if (!assignment) {
    throw new ForbiddenError(`Papel "${role}" é necessário para esta ação.`);
  }
  return ctx;
}

export async function requirePermission(permission: PermissionKey | (string & {})) {
  const ctx = await requireCompany();
  const assignment = await findAuthorizedUserRole(ctx.user.id, ctx.companyId, {
    permissions: { some: { permission: { key: permission } } },
  });
  if (!assignment) {
    throw new ForbiddenError(`Permissão "${permission}" é necessária para esta ação.`);
  }
  return ctx;
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

/**
 * Variante não-lançável de `requireCompany()` — devolve o `companyId`
 * resolvido (via `CompanyMembership`, com todas as regras de dual-read) ou
 * `null` quando não há sessão/membership válida/contexto ambíguo. Usada por
 * páginas públicas-condicionais (ex.: lib/qr-code.ts) que precisam comparar
 * "este visitante está na mesma empresa do recurso?" sem travar a página
 * inteira para quem não tem contexto resolvido (visitante anônimo, por
 * exemplo). Nunca usar `User.companyId` bruto para essa comparação — Sprint
 * 0.6, Parte A.2.
 */
export async function getResolvedCompanyId(): Promise<string | null> {
  try {
    const { companyId } = await requireCompany();
    return companyId;
  } catch (error) {
    if (
      error instanceof AuthError ||
      error instanceof ForbiddenError ||
      error instanceof CompanySelectionRequiredError
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Variante não-lançável e "crua" de `requireCompany()` — devolve o resultado
 * completo do resolver central (`ResolveCompanyContextResult`), incluindo os
 * estados que normalmente virariam erro (`SELECTION_REQUIRED`,
 * `NO_ACTIVE_MEMBERSHIP`, etc.). Usada pela API e pela página de seleção de
 * empresa (Sprint 0.6, Partes C/D), que precisam DISTINGUIR esses estados
 * para orientar o usuário — não apenas bloquear. `null` só quando não há
 * sessão. Nunca usar isto para autorizar acesso a dado de negócio: para
 * isso, sempre `requireCompany()`/`requirePermission()`.
 */
export async function resolveCurrentCompanyContext() {
  const user = await getCurrentUser();
  if (!user) return null;
  const requestedCompanyId = await getRequestedCompanyId();
  return resolveCompanyContext({ userId: user.id, legacyCompanyId: user.companyId, requestedCompanyId });
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

/**
 * Variante `requireCompany()` para uso direto em páginas — necessária a
 * partir da Sprint 0.5 para qualquer página que leia/escreva dado de negócio
 * por `companyId` mas não exija uma permissão específica (ex.: dashboard,
 * cadastros de apoio). Substitui o padrão antigo "`requireAuthOrDeny()` +
 * `user.companyId` cru", que nunca validava `CompanyMembership`.
 */
export async function requireCompanyOrDeny() {
  try {
    return await requireCompany();
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    // SELECTION_REQUIRED nunca é um "acesso negado" genérico — o usuário
    // está autenticado e tem memberships válidas, só falta escolher qual.
    // Redireciona para a página dedicada (Sprint 0.6, Parte D) em vez de
    // renderizar app/forbidden.tsx.
    if (error instanceof CompanySelectionRequiredError) redirect("/select-company");
    // Sprint SST 1.4C, §11 — claim pendente nunca vira app/forbidden.tsx
    // nem entra no Portal Empresa: sempre a página de acompanhamento.
    if (error instanceof CompanyClaimPendingError) redirect("/company-claim/pending");
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requirePermissionOrDeny(permission: PermissionKey | (string & {})) {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof CompanySelectionRequiredError) redirect("/select-company");
    // Sprint SST 1.4C, §11 — claim pendente nunca vira app/forbidden.tsx
    // nem entra no Portal Empresa: sempre a página de acompanhamento.
    if (error instanceof CompanyClaimPendingError) redirect("/company-claim/pending");
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requireRoleOrDeny(role: SystemRole | (string & {})) {
  try {
    return await requireRole(role);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof CompanySelectionRequiredError) redirect("/select-company");
    // Sprint SST 1.4C, §11 — claim pendente nunca vira app/forbidden.tsx
    // nem entra no Portal Empresa: sempre a página de acompanhamento.
    if (error instanceof CompanyClaimPendingError) redirect("/company-claim/pending");
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
