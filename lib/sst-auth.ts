import { forbidden, unauthorized } from "next/navigation";

import { AuthError, ForbiddenError, requireAuth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import type { SstProviderUserRole } from "@/app/generated/prisma/client";

// Autorização do Portal Consultoria SST (rotas /sst e /api/sst) — módulo
// deliberadamente separado de lib/auth-server.ts. O tenant deste portal é
// sempre SstProvider, nunca Company/User.companyId: reaproveitamos apenas
// requireAuth() (resolução de identidade — sessão Better Auth, comum a todo
// o app) e as classes AuthError/ForbiddenError (para que handleApiError
// continue funcionando sem mudança). Nunca misturar com
// requirePermission/requireCompany, que são RBAC do Portal Empresa.

export async function requireSstAuth() {
  const user = await requireAuth();
  const sstProviderUser = await prisma.sstProviderUser.findFirst({
    where: { userId: user.id, active: true, provider: { active: true } },
    include: { provider: true },
    // Se o mesmo usuário tiver vínculo com mais de uma consultoria (não há
    // seletor de consultoria na UI ainda), usa sempre o vínculo mais
    // antigo — simplificação documentada em docs/portal-consultoria.md.
    orderBy: { createdAt: "asc" },
  });
  if (!sstProviderUser) {
    throw new ForbiddenError("Este usuário não possui acesso ao Portal Consultoria.");
  }
  return { user, sstProviderUser, providerId: sstProviderUser.providerId };
}

export async function getCurrentSstUser() {
  try {
    return await requireSstAuth();
  } catch (error) {
    if (error instanceof AuthError || error instanceof ForbiddenError) return null;
    throw error;
  }
}

export async function getCurrentSstProvider() {
  const { sstProviderUser } = await requireSstAuth();
  return sstProviderUser.provider;
}

export async function requireSstRole(role: SstProviderUserRole) {
  const ctx = await requireSstAuth();
  if (ctx.sstProviderUser.role !== role) {
    throw new ForbiddenError(`Papel "${role}" é necessário para esta ação.`);
  }
  return ctx;
}

/**
 * Garante que a consultoria autenticada tem um vínculo ACTIVE com a empresa
 * informada. `companyId` normalmente vem da URL (nunca do client como
 * "providerId" — o provider vem sempre da sessão) e precisa ser
 * revalidado aqui antes de qualquer leitura de dados da empresa.
 */
export async function requireSstProviderCompanyAccess(companyId: string) {
  const ctx = await requireSstAuth();
  const link = await prisma.sstProviderCompany.findFirst({
    where: { providerId: ctx.providerId, companyId, status: "ACTIVE" },
  });
  if (!link) {
    throw new ForbiddenError("Esta consultoria não tem acesso a esta empresa.");
  }
  return { ...ctx, companyId, link };
}

// --- Matriz de acesso (Sprint 1.2 — ver docs/portal-consultoria.md) ---
//
// role === VIEWER nunca escreve, independente do accessLevel do vínculo.
// Para OWNER/TECHNICIAN, quem decide é só o accessLevel — esta sprint não
// implementa nenhuma ação exclusiva de OWNER (gestão do próprio provider é
// fora de escopo), então os dois papéis se comportam igual para ações de
// treinamento.

function assertRoleCanWrite(role: SstProviderUserRole) {
  if (role === "VIEWER") {
    throw new ForbiddenError("Seu papel nesta consultoria permite apenas consulta.");
  }
}

/** Alias explícito de requireSstProviderCompanyAccess — qualquer vínculo
 * ACTIVE (independente de role/accessLevel) já concede leitura. Existe só
 * para nomear a intenção nas rotas de leitura, espelhando
 * requireSstCompanyOperationAccess/requireSstCompanyAdministrationAccess. */
export async function requireSstCompanyViewAccess(companyId: string) {
  return requireSstProviderCompanyAccess(companyId);
}

/** Ações operacionais (criar/editar turma, adicionar/remover participante,
 * registrar presença/resultado) — exige accessLevel OPERATION ou
 * ADMINISTRATION e role diferente de VIEWER. */
export async function requireSstCompanyOperationAccess(companyId: string) {
  const ctx = await requireSstProviderCompanyAccess(companyId);
  assertRoleCanWrite(ctx.sstProviderUser.role);
  if (ctx.link.accessLevel === "VIEW") {
    throw new ForbiddenError("Esta consultoria só tem acesso de visualização para esta empresa.");
  }
  return ctx;
}

/** Ações administrativas (criar/editar/desativar CompanyTraining) — exige
 * accessLevel ADMINISTRATION e role diferente de VIEWER. */
export async function requireSstCompanyAdministrationAccess(companyId: string) {
  const ctx = await requireSstProviderCompanyAccess(companyId);
  assertRoleCanWrite(ctx.sstProviderUser.role);
  if (ctx.link.accessLevel !== "ADMINISTRATION") {
    throw new ForbiddenError("Esta ação exige acesso de Administração para esta empresa.");
  }
  return ctx;
}

type SstAccessContext = {
  sstProviderUser: { role: SstProviderUserRole };
  link: { accessLevel: "VIEW" | "OPERATION" | "ADMINISTRATION" };
};

/** Variante não-lançável de requireSstCompanyOperationAccess — usada nas
 * páginas para decidir se mostra botões de escrita ("Nova turma", etc.),
 * sem bloquear a página inteira para quem só tem VIEW (ver seção 12 do
 * requisito: "Você possui acesso somente para consulta."). */
export function sstCanOperate(ctx: SstAccessContext) {
  return ctx.sstProviderUser.role !== "VIEWER" && ctx.link.accessLevel !== "VIEW";
}

/** Variante não-lançável de requireSstCompanyAdministrationAccess — mesmo
 * uso de sstCanOperate, para decisões de UI (ex.: botão "Novo
 * treinamento"). */
export function sstCanAdminister(ctx: SstAccessContext) {
  return ctx.sstProviderUser.role !== "VIEWER" && ctx.link.accessLevel === "ADMINISTRATION";
}

/**
 * Constrói o ActorInput (lib/audit.ts) a partir de um contexto já
 * autenticado do Portal Consultoria — usado em toda chamada aos services de
 * treinamento reaproveitados do Portal Empresa (createCompanyTraining,
 * createTrainingClass, addParticipants, etc.). `id` é sempre o `User.id`
 * real (FK de AuditLog.actorUserId), nunca o id de SstProviderUser.
 */
export function buildSstActor(ctx: { user: { id: string; name: string }; providerId: string }) {
  return {
    id: ctx.user.id,
    name: ctx.user.name,
    actorType: "SST_PROVIDER_USER" as const,
    providerId: ctx.providerId,
  };
}

// --- Variantes para uso direto em Server Components (páginas /sst/*) ---
// Mesmo padrão de requireAuthOrDeny/requirePermissionOrDeny em
// lib/auth-server.ts, usando os boundaries app/sst/unauthorized.tsx e
// app/sst/forbidden.tsx (mais próximos da rota que os da raiz).

export async function requireSstAuthOrDeny() {
  try {
    return await requireSstAuth();
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requireSstProviderCompanyAccessOrDeny(companyId: string) {
  try {
    return await requireSstProviderCompanyAccess(companyId);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

// Usadas em páginas de escrita acessadas diretamente por URL (ex.:
// /trainings/new, /classes/new) — diferente de sstCanOperate/sstCanAdminister
// (que só escondem botões em telas de leitura), aqui a página inteira exige
// o nível de acesso, então um usuário sem permissão vê o boundary
// app/sst/forbidden.tsx em vez de uma tela quebrada.

export async function requireSstCompanyOperationAccessOrDeny(companyId: string) {
  try {
    return await requireSstCompanyOperationAccess(companyId);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function requireSstCompanyAdministrationAccessOrDeny(companyId: string) {
  try {
    return await requireSstCompanyAdministrationAccess(companyId);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}
