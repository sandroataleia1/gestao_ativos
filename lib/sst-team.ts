import { prisma } from "@/lib/prisma";
import type { SstProviderUserRole } from "@/app/generated/prisma/client";

// ============================================================================
// Gestão da equipe de uma consultoria (SstProviderUser) — Sprint Demo
// Comercial SST 1.0, Parte 3. Domínio isolado de lib/sst-providers.ts (que
// cuida do vínculo SstProvider<->Company do lado da EMPRESA); este arquivo
// cuida de quem TEM ACESSO ao Portal Consultoria, do lado do prestador.
//
// Sem convite pendente: o modelo atual (`SstProviderUser`) não tem
// status/invitedAt — "adicionar usuário existente" cria o vínculo já
// ATIVO diretamente. Não é um convite, é uma adição direta (só usuários
// globais já existentes, nunca cria conta nova).
// ============================================================================

export type SstTeamMember = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: SstProviderUserRole;
  active: boolean;
  joinedAt: string;
  isCurrentUser: boolean;
};

/**
 * Lista a equipe da consultoria. `email` só é preenchido quando
 * `includeEmail` é true (reservado a OWNER — ver rota) — nunca vaza e-mail
 * para TECHNICIAN/VIEWER.
 */
export async function listTeamMembers(
  providerId: string,
  viewerUserId: string,
  includeEmail: boolean,
): Promise<SstTeamMember[]> {
  const members = await prisma.sstProviderUser.findMany({
    where: { providerId },
    select: {
      id: true,
      userId: true,
      role: true,
      active: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: includeEmail ? m.user.email : null,
    role: m.role,
    active: m.active,
    joinedAt: m.createdAt.toISOString(),
    isCurrentUser: m.userId === viewerUserId,
  }));
}

async function countActiveOwners(providerId: string): Promise<number> {
  return prisma.sstProviderUser.count({ where: { providerId, role: "OWNER", active: true } });
}

export type AddExistingUserResult =
  | { status: "ADDED"; memberId: string }
  | { status: "ALREADY_MEMBER" }
  | { status: "USER_NOT_FOUND" };

/**
 * Adiciona um usuário GLOBAL EXISTENTE à consultoria — nunca cria conta
 * nova. `providerId` sempre do parâmetro (que a rota deriva de
 * requireSstRole("OWNER"), nunca do body). Idempotente: se o vínculo já
 * existir (qualquer role/status), não duplica.
 */
export async function addExistingUserToTeam(params: {
  providerId: string;
  email: string;
  role: SstProviderUserRole;
}): Promise<AddExistingUserResult> {
  const targetUser = await prisma.user.findUnique({ where: { email: params.email }, select: { id: true } });
  if (!targetUser) return { status: "USER_NOT_FOUND" };

  const existing = await prisma.sstProviderUser.findUnique({
    where: { providerId_userId: { providerId: params.providerId, userId: targetUser.id } },
  });
  if (existing) return { status: "ALREADY_MEMBER" };

  const created = await prisma.sstProviderUser.create({
    data: { providerId: params.providerId, userId: targetUser.id, role: params.role, active: true },
  });
  return { status: "ADDED", memberId: created.id };
}

export type ChangeRoleResult = "CHANGED" | "NOT_FOUND" | "LAST_OWNER_PROTECTED";

/**
 * Troca o papel de um membro. Nunca deixa a consultoria sem nenhum OWNER
 * ativo — a checagem é sempre pela CONTAGEM de OWNERs ativos restantes,
 * então cobre tanto "o próprio OWNER se rebaixando" quanto "outro OWNER
 * rebaixando alguém" com a mesma regra.
 */
export async function changeTeamMemberRole(
  providerId: string,
  memberId: string,
  newRole: SstProviderUserRole,
): Promise<ChangeRoleResult> {
  const member = await prisma.sstProviderUser.findFirst({ where: { id: memberId, providerId } });
  if (!member) return "NOT_FOUND";

  if (member.role === "OWNER" && newRole !== "OWNER" && member.active) {
    const activeOwnerCount = await countActiveOwners(providerId);
    if (activeOwnerCount <= 1) return "LAST_OWNER_PROTECTED";
  }

  await prisma.sstProviderUser.update({ where: { id: memberId }, data: { role: newRole } });
  return "CHANGED";
}

export type DeactivateResult = "DEACTIVATED" | "NOT_FOUND" | "ALREADY_INACTIVE" | "LAST_OWNER_PROTECTED";

export async function deactivateTeamMember(providerId: string, memberId: string): Promise<DeactivateResult> {
  const member = await prisma.sstProviderUser.findFirst({ where: { id: memberId, providerId } });
  if (!member) return "NOT_FOUND";
  if (!member.active) return "ALREADY_INACTIVE";

  if (member.role === "OWNER") {
    const activeOwnerCount = await countActiveOwners(providerId);
    if (activeOwnerCount <= 1) return "LAST_OWNER_PROTECTED";
  }

  // `active = false` (não hard delete) — a próxima requisição autenticada
  // desse usuário já é bloqueada por requireSstAuth() (que filtra
  // `active: true` a cada chamada, sem cache entre requisições), mesmo com
  // sessão Better Auth ainda válida.
  await prisma.sstProviderUser.update({ where: { id: memberId }, data: { active: false } });
  return "DEACTIVATED";
}

export type ReactivateResult = "REACTIVATED" | "NOT_FOUND" | "ALREADY_ACTIVE";

export async function reactivateTeamMember(providerId: string, memberId: string): Promise<ReactivateResult> {
  const member = await prisma.sstProviderUser.findFirst({ where: { id: memberId, providerId } });
  if (!member) return "NOT_FOUND";
  if (member.active) return "ALREADY_ACTIVE";

  await prisma.sstProviderUser.update({ where: { id: memberId }, data: { active: true } });
  return "REACTIVATED";
}
