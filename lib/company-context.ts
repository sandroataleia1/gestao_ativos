import { prisma } from "@/lib/prisma";

// ============================================================================
// Resolver central de contexto empresarial — ver docs/adr/ADR-001, seções
// 1.1/2/3/4/5.
//
// Módulo de DOMÍNIO PURO: recebe entradas explícitas, consulta o banco via
// Prisma, devolve uma união discriminada. Nunca importa `next/headers`,
// `cookies()`, `redirect()`, nada de Route Handler, React (`cache`, etc.) ou
// Better Auth. Isso é o que permite este mesmo módulo ser chamado tanto por
// `requireCompany()` (Server Component/Route Handler, via
// lib/company-context-request.ts para obter `requestedCompanyId`) quanto
// pelos hooks do Better Auth (lib/auth.ts, que rodam fora de um request
// scope do Next e não podem usar `next/headers`).
//
// `CompanyMembership` é a fonte real de autorização a partir desta sprint;
// `User.companyId` é só uma PREFERÊNCIA legada temporária (nunca concede
// acesso sozinho — ver Parte I da Sprint 0.5). Nenhum cookie é lido aqui:
// quem chama este módulo já deve ter resolvido `requestedCompanyId` (ou
// deliberadamente não ter um) antes de chamar.
// ============================================================================

export type ResolveCompanyContextInput = {
  userId: string;
  /** `User.companyId` — preferência legada, nunca usada como fallback quando
   * `requestedCompanyId` foi informado (mesmo que inválido). */
  legacyCompanyId?: string | null;
  /** Preferência de contexto vinda de fora (cookie/sessão) — NÃO É prova de
   * autorização; sempre revalidada aqui contra uma membership ACTIVE. */
  requestedCompanyId?: string | null;
};

export type CompanyContextSource = "REQUESTED" | "LEGACY" | "ONLY_ACTIVE_MEMBERSHIP";

export type ResolveCompanyContextResult =
  | {
      status: "RESOLVED";
      userId: string;
      companyId: string;
      membershipId: string;
      source: CompanyContextSource;
    }
  | {
      status: "NO_ACTIVE_MEMBERSHIP";
    }
  | {
      status: "SELECTION_REQUIRED";
      activeMembershipCount: number;
    }
  | {
      status: "INVALID_REQUESTED_CONTEXT";
    }
  | {
      status: "COMPANY_UNAVAILABLE";
      reason: "INACTIVE_LEGACY_FLAG" | "SUSPENDED" | "CLOSED";
    };

type CompanyAvailabilityFields = { active: boolean; operationalStatus: string };

/**
 * Regra de disponibilidade da empresa durante a transição (ver Parte B):
 * `Company.active = true AND Company.operationalStatus = ACTIVE`. Nenhum dos
 * dois campos é removido/alterado nesta sprint — só passam a ser lidos aqui.
 */
function isCompanyAvailable(company: CompanyAvailabilityFields): boolean {
  return company.active === true && company.operationalStatus === "ACTIVE";
}

/** `active` (flag legada) tem prioridade na razão reportada — é o sinal mais
 * antigo/grosseiro; se ele já reprova a empresa, não faz sentido inspecionar
 * `operationalStatus` também. */
function unavailabilityReason(
  company: CompanyAvailabilityFields,
): "INACTIVE_LEGACY_FLAG" | "SUSPENDED" | "CLOSED" {
  if (!company.active) return "INACTIVE_LEGACY_FLAG";
  if (company.operationalStatus === "SUSPENDED") return "SUSPENDED";
  return "CLOSED";
}

const COMPANY_MEMBERSHIP_SELECTION_LIMIT = 2;

/**
 * Resolve qual `companyId` uma sessão de usuário deve usar, dado (opcionalmente)
 * uma preferência solicitada e a preferência legada (`User.companyId`).
 *
 * Algoritmo (ver Sprint 0.5, Parte B):
 *
 * COM `requestedCompanyId`:
 *   1. Busca membership ACTIVE para (userId, requestedCompanyId).
 *   2. Se não existir, `INVALID_REQUESTED_CONTEXT` — sem consultar a
 *      `Company` (nunca revela se ela existe/qual o nome) e sem fallback
 *      para `legacyCompanyId`.
 *   3. Se existir, valida a disponibilidade da empresa; indisponível vira
 *      `COMPANY_UNAVAILABLE` com o motivo.
 *   4. Caso contrário, `RESOLVED` com `source: "REQUESTED"`.
 *
 * SEM `requestedCompanyId`:
 *   1. Se houver `legacyCompanyId`, busca membership ACTIVE correspondente;
 *      se existir e a empresa estiver disponível, `RESOLVED` com
 *      `source: "LEGACY"`.
 *   2. Caso contrário (membership legada ausente OU empresa indisponível),
 *      busca no máximo 2 memberships ACTIVE com empresa disponível:
 *        - 0 → `NO_ACTIVE_MEMBERSHIP`;
 *        - 1 → `RESOLVED` com `source: "ONLY_ACTIVE_MEMBERSHIP"`;
 *        - 2+ → `SELECTION_REQUIRED` (nunca escolhe a mais antiga/primeira).
 */
export async function resolveCompanyContext(
  input: ResolveCompanyContextInput,
): Promise<ResolveCompanyContextResult> {
  const { userId, legacyCompanyId, requestedCompanyId } = input;

  // --- Com requestedCompanyId -----------------------------------------
  if (requestedCompanyId) {
    const membership = await prisma.companyMembership.findFirst({
      where: { userId, companyId: requestedCompanyId, status: "ACTIVE" },
      select: { id: true, companyId: true },
    });

    if (!membership) {
      // Nunca consulta `Company` aqui — um requestedCompanyId de uma
      // empresa inexistente e um de uma empresa real sem membership ACTIVE
      // (REVOKED/SUSPENDED/INVITED/nenhuma) devem ser indistinguíveis.
      return { status: "INVALID_REQUESTED_CONTEXT" };
    }

    const company = await prisma.company.findUnique({
      where: { id: membership.companyId },
      select: { active: true, operationalStatus: true },
    });

    // Membership aponta para uma Company via FK obrigatória — `company`
    // nulo aqui seria uma inconsistência de dado, não um caminho de
    // usuário; tratamos como indisponível por segurança, nunca como resolvido.
    if (!company || !isCompanyAvailable(company)) {
      return {
        status: "COMPANY_UNAVAILABLE",
        reason: company ? unavailabilityReason(company) : "CLOSED",
      };
    }

    return {
      status: "RESOLVED",
      userId,
      companyId: membership.companyId,
      membershipId: membership.id,
      source: "REQUESTED",
    };
  }

  // --- Sem requestedCompanyId — tenta a preferência legada primeiro ----
  if (legacyCompanyId) {
    const legacyMembership = await prisma.companyMembership.findFirst({
      where: { userId, companyId: legacyCompanyId, status: "ACTIVE" },
      select: { id: true, companyId: true },
    });

    if (legacyMembership) {
      const company = await prisma.company.findUnique({
        where: { id: legacyMembership.companyId },
        select: { active: true, operationalStatus: true },
      });

      if (company && isCompanyAvailable(company)) {
        return {
          status: "RESOLVED",
          userId,
          companyId: legacyMembership.companyId,
          membershipId: legacyMembership.id,
          source: "LEGACY",
        };
      }
      // Membership legada existe mas a empresa está indisponível — cai para
      // a busca de memberships ativas abaixo (não retorna COMPANY_UNAVAILABLE
      // diretamente: pode haver outra empresa perfeitamente disponível).
    }
  }

  // --- Fallback: no máximo 2 memberships ACTIVE com empresa disponível -
  const candidates = await prisma.companyMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      company: { active: true, operationalStatus: "ACTIVE" },
    },
    select: { id: true, companyId: true },
    take: COMPANY_MEMBERSHIP_SELECTION_LIMIT,
    // Sem `orderBy` por data — a ordem não importa porque nunca escolhemos
    // "a primeira" quando há mais de uma (ver abaixo); com exatamente 1
    // candidata a ordem é irrelevante.
  });

  if (candidates.length === 0) {
    return { status: "NO_ACTIVE_MEMBERSHIP" };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      status: "RESOLVED",
      userId,
      companyId: only.companyId,
      membershipId: only.id,
      source: "ONLY_ACTIVE_MEMBERSHIP",
    };
  }

  // 2+: nunca decide sozinho — conta o total real (consulta extra, só neste
  // caminho raro) e devolve SELECTION_REQUIRED para quem chamou decidir a UX.
  const activeMembershipCount = await prisma.companyMembership.count({
    where: {
      userId,
      status: "ACTIVE",
      company: { active: true, operationalStatus: "ACTIVE" },
    },
  });

  return { status: "SELECTION_REQUIRED", activeMembershipCount };
}

// ============================================================================
// Resolução SEM seleção humana — Sprint 0.6, Parte A.1.
//
// `resolveCompanyContext()` (acima) prioriza deliberadamente `legacyCompanyId`
// quando ela tem uma membership ACTIVE válida — correto para servir
// requisições de página/API (é o comportamento "cai na sua empresa de
// sempre" esperado por um usuário humano). Mas em contextos SEM nenhuma
// seleção humana envolvida (ex.: os hooks de login/logout do Better Auth,
// que só precisam de um `companyId` para etiquetar uma linha de `AuditLog`),
// usar esse mesmo atalho seria escolher arbitrariamente uma entre várias
// empresas igualmente válidas só porque `User.companyId` aponta pra ela.
//
// `resolveUnambiguousCompany()` nunca dá prioridade à legada: só resolve
// quando existe exatamente UMA membership ACTIVE com empresa disponível,
// seja ela qual for (pode até ser a legada, mas só por ser a única opção,
// nunca por prioridade).
// ============================================================================

export type ResolveUnambiguousCompanyResult =
  | { status: "RESOLVED"; companyId: string; membershipId: string }
  | { status: "NONE" }
  | { status: "AMBIGUOUS"; activeMembershipCount: number };

export async function resolveUnambiguousCompany(userId: string): Promise<ResolveUnambiguousCompanyResult> {
  const candidates = await prisma.companyMembership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      company: { active: true, operationalStatus: "ACTIVE" },
    },
    select: { id: true, companyId: true },
    take: COMPANY_MEMBERSHIP_SELECTION_LIMIT,
  });

  if (candidates.length === 0) {
    return { status: "NONE" };
  }

  if (candidates.length === 1) {
    return { status: "RESOLVED", companyId: candidates[0].companyId, membershipId: candidates[0].id };
  }

  const activeMembershipCount = await prisma.companyMembership.count({
    where: {
      userId,
      status: "ACTIVE",
      company: { active: true, operationalStatus: "ACTIVE" },
    },
  });

  return { status: "AMBIGUOUS", activeMembershipCount };
}
