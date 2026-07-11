import { prisma } from "@/lib/prisma";
import { resolveCompanyContext, type ResolveCompanyContextResult } from "@/lib/company-context";

// ============================================================================
// Domínio de seleção empresarial — Sprint 0.6, Parte B.
//
// Funções independentes de UI/Next.js (mesma disciplina de
// lib/company-context.ts: sem `next/headers`, `cookies()`, `redirect()`,
// React ou Better Auth) para listar as empresas selecionáveis de um
// usuário, seus convites pendentes, e validar uma seleção explícita.
// ============================================================================

export type AvailableCompanyContext = {
  companyId: string;
  membershipId: string;
  companyName: string;
};

/**
 * Empresas que o usuário pode selecionar agora: membership `ACTIVE` +
 * empresa disponível (`active=true` e `operationalStatus=ACTIVE`) — mesma
 * regra de disponibilidade do resolver central. Só os campos necessários à
 * interface (nunca CNPJ, dados de colaboradores, plano ou detalhe de outras
 * memberships).
 */
export async function listAvailableCompanyContexts(userId: string): Promise<AvailableCompanyContext[]> {
  const memberships = await prisma.companyMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      company: { active: true, operationalStatus: "ACTIVE" },
    },
    select: {
      id: true,
      companyId: true,
      company: { select: { name: true, tradeName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({
    companyId: m.companyId,
    membershipId: m.id,
    companyName: m.company.tradeName || m.company.name,
  }));
}

export type PendingCompanyInvitation = {
  membershipId: string;
  companyId: string;
  companyName: string;
  invitedAt: string;
  roleNames: string[];
};

/**
 * Convites pendentes (`status = INVITED`) do usuário autenticado — nunca de
 * outro usuário (sempre filtrado por `userId` da sessão, no chamador). Papel
 * previamente associado vem de `UserRole` (não há FK direta entre
 * `CompanyMembership` e `Role`/`UserRole` — ver ADR-001, §3), incluído só
 * para exibição, nunca usado para conceder acesso.
 */
export async function listPendingCompanyInvitations(userId: string): Promise<PendingCompanyInvitation[]> {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId, status: "INVITED" },
    select: {
      id: true,
      companyId: true,
      invitedAt: true,
      company: { select: { name: true, tradeName: true } },
    },
    orderBy: { invitedAt: "desc" },
  });

  if (memberships.length === 0) return [];

  const companyIds = memberships.map((m) => m.companyId);
  const roles = await prisma.userRole.findMany({
    where: { userId, companyId: { in: companyIds } },
    select: { companyId: true, role: { select: { name: true } } },
  });
  const roleNamesByCompany = new Map<string, string[]>();
  for (const r of roles) {
    const list = roleNamesByCompany.get(r.companyId) ?? [];
    list.push(r.role.name);
    roleNamesByCompany.set(r.companyId, list);
  }

  return memberships.map((m) => ({
    membershipId: m.id,
    companyId: m.companyId,
    companyName: m.company.tradeName || m.company.name,
    invitedAt: m.invitedAt.toISOString(),
    roleNames: roleNamesByCompany.get(m.companyId) ?? [],
  }));
}

/**
 * Valida uma seleção explícita de empresa — delega inteiramente ao resolver
 * central (`resolveCompanyContext` com `requestedCompanyId`), nunca
 * duplicando a validação de membership/disponibilidade. Quem chama (a rota
 * de API, Parte C) decide o que fazer com cada status do resultado —
 * inclusive gravar o cookie somente quando `status === "RESOLVED"`.
 */
export async function selectCompanyContext(
  userId: string,
  companyId: string,
): Promise<ResolveCompanyContextResult> {
  return resolveCompanyContext({ userId, requestedCompanyId: companyId });
}
