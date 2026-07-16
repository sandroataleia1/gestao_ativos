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

// --- Sprint SST 1.4F — colaboradores (Employee) geridos pela consultoria ---
//
// Guard dedicado (em vez de reaproveitar requireSstCompanyOperationAccess
// diretamente): Employee tem uma dimensão extra que treinamento não tem —
// o estado de CONTROLE da Company (`controlStatus`). Uma claim em análise
// (CLAIM_PENDING) ou disputada (DISPUTED) nunca pode ser mutada pela
// consultoria (§8 do spec da sprint), mas continua podendo ser LIDA
// enquanto o vínculo seguir ACTIVE — daí dois guards com política
// diferente, não um só. Nenhum dos dois consulta User.companyId/
// active_company_id — só a sessão (via requireSstAuth) e o banco, sempre
// revalidados a cada request.

/** Erro de domínio estável (mesmo padrão de CompanyClaimPendingError em
 * lib/auth-server.ts) — nunca revela identidade do solicitante, motivo da
 * disputa ou dados do Super Admin; só informa que uma revisão de controle
 * está em andamento. Mapeado para 409 em lib/api-errors.ts. */
export class CompanyControlReviewInProgressError extends Error {
  constructor() {
    super("A empresa está concluindo a revisão do cadastro. Alterações permanecem temporariamente bloqueadas.");
    this.name = "CompanyControlReviewInProgressError";
  }
}

const BLOCKED_OPERATIONAL_STATUSES = ["SUSPENDED", "CLOSED"] as const;

type EmployeeAccessLink = {
  accessLevel: "VIEW" | "OPERATION" | "ADMINISTRATION";
  authorizationBasis: "COMPANY_APPROVAL" | "PROVIDER_PRE_REGISTRATION" | "SUPER_ADMIN";
};
type EmployeeAccessCompany = {
  operationalStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  controlStatus: "UNCLAIMED" | "CLAIM_PENDING" | "CLAIMED" | "DISPUTED";
};

async function resolveEmployeeAccessLink(companyId: string) {
  const ctx = await requireSstAuth();
  const link = await prisma.sstProviderCompany.findFirst({
    where: { providerId: ctx.providerId, companyId, status: "ACTIVE" },
    include: {
      company: {
        select: { id: true, name: true, tradeName: true, operationalStatus: true, controlStatus: true },
      },
    },
  });
  if (!link) {
    throw new ForbiddenError("Esta consultoria não tem acesso a esta empresa.");
  }
  // UNCLAIMED só concede acesso (leitura ou escrita) quando o vínculo ATIVO
  // nasceu do próprio pré-cadastro desta consultoria (§6 do spec) — nunca a
  // uma segunda consultoria. Na prática nenhum outro vínculo consegue
  // chegar a ACTIVE enquanto a empresa é UNCLAIMED (não há administrador
  // para aprovar COMPANY_APPROVAL), mas o check abaixo é defesa em
  // profundidade explícita, não presumida.
  if (link.company.controlStatus === "UNCLAIMED" && link.authorizationBasis !== "PROVIDER_PRE_REGISTRATION") {
    throw new ForbiddenError("Esta consultoria não tem acesso a esta empresa.");
  }
  if (BLOCKED_OPERATIONAL_STATUSES.includes(link.company.operationalStatus as (typeof BLOCKED_OPERATIONAL_STATUSES)[number])) {
    // Mensagem genérica de propósito — nunca revela se é suspensão ou
    // encerramento (motivo administrativo interno, ver §6/§8).
    throw new ForbiddenError("Esta empresa não está disponível para operação no momento.");
  }
  return { ...ctx, companyId, link, company: link.company };
}

/**
 * Leitura de colaboradores — permite visualizar enquanto o vínculo estiver
 * ACTIVE e a Company não estiver SUSPENDED/CLOSED, INDEPENDENTE de
 * accessLevel/role (mesmo VIEWER e mesmo accessLevel VIEW leem) e
 * independente de controlStatus (CLAIM_PENDING/DISPUTED continuam
 * legíveis — só a escrita é bloqueada nesses estados, ver
 * requireSstProviderEmployeeManageAccess).
 */
export async function requireSstProviderEmployeeViewAccess(companyId: string) {
  return resolveEmployeeAccessLink(companyId);
}

/**
 * Gestão de colaboradores (criar/editar/inativar/reativar) — exige, além do
 * necessário para leitura: papel diferente de VIEWER, accessLevel OPERATION
 * ou ADMINISTRATION (VIEW nunca gerencia), e controlStatus fora de
 * CLAIM_PENDING/DISPUTED (§8 — revisão de controle em andamento bloqueia
 * toda mutação, mesmo para quem já tinha ADMINISTRATION antes da claim).
 */
export async function requireSstProviderEmployeeManageAccess(companyId: string) {
  const ctx = await resolveEmployeeAccessLink(companyId);
  assertRoleCanWrite(ctx.sstProviderUser.role);
  if (ctx.link.accessLevel === "VIEW") {
    throw new ForbiddenError("Esta consultoria só tem acesso de visualização para esta empresa.");
  }
  if (ctx.company.controlStatus === "CLAIM_PENDING" || ctx.company.controlStatus === "DISPUTED") {
    throw new CompanyControlReviewInProgressError();
  }
  return ctx;
}

/** Variante não-lançável — usada pela UI para decidir se mostra
 * "Novo colaborador"/ações de edição, sem quebrar a página inteira para
 * quem só tem leitura (mesmo espírito de sstCanOperate/sstCanAdminister). */
export function sstCanManageEmployees(ctx: { sstProviderUser: { role: SstProviderUserRole }; link: EmployeeAccessLink; company: EmployeeAccessCompany }) {
  if (ctx.sstProviderUser.role === "VIEWER") return false;
  if (ctx.link.accessLevel === "VIEW") return false;
  if (ctx.company.controlStatus === "CLAIM_PENDING" || ctx.company.controlStatus === "DISPUTED") return false;
  return true;
}

export async function requireSstProviderEmployeeViewAccessOrDeny(companyId: string) {
  try {
    return await requireSstProviderEmployeeViewAccess(companyId);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

/** Usada pelas páginas de cadastro/edição (URLs diretas) — a listagem já
 * esconde os links para estas páginas quando `sstCanManageEmployees` é
 * falso (§22: "não depender somente da interface"), então chegar aqui sem
 * poder gerenciar só acontece por navegação direta/manipulada. Uma revisão
 * de controle em andamento também vira o boundary genérico de acesso
 * negado aqui — a mensagem específica (CompanyControlReviewInProgressError)
 * é mostrada pela API/listagem, não por este boundary de página inteira. */
export async function requireSstProviderEmployeeManageAccessOrDeny(companyId: string) {
  try {
    return await requireSstProviderEmployeeManageAccess(companyId);
  } catch (error) {
    if (error instanceof AuthError) unauthorized();
    if (error instanceof ForbiddenError || error instanceof CompanyControlReviewInProgressError) forbidden();
    throw error;
  }
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

/** Variante `OrDeny` de `requireSstRole` — usada por páginas acessadas
 * diretamente por URL (ex.: /sst/companies/new) que exigem um papel
 * específico (Sprint Comercial SST 1.4, §9: só OWNER inicia pré-cadastro/
 * solicitação de acesso). */
export async function requireSstRoleOrDeny(role: SstProviderUserRole) {
  try {
    return await requireSstRole(role);
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
