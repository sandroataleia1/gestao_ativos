import { looksLikeDemoData } from "@/lib/demo-data";

// Sprint SST 1.4D.1, §3 — classificação PURA (sem I/O) de uma
// CompanyMembership ACTIVE em relação à janela de exposição do fluxo
// inseguro de registro (commit 42fc120). Extraída para módulo próprio para
// ser testável sem banco (mesmo padrão de lib/claim-exposure-timestamp.ts).
//
// Nunca classifica como legítima só porque a Company está CLAIMED hoje —
// controlStatus é estado ATUAL, não histórico; a classificação depende
// exclusivamente dos sinais de PROVENIÊNCIA da membership (convite,
// aprovação de claim, origem da empresa, timing de criação).

export type MembershipClassification =
  | "SUSPICIOUS_INSECURE_FLOW"
  | "LEGITIMATE_INVITE"
  | "LEGITIMATE_CLAIM_APPROVED"
  | "SEED_OR_DEMO"
  | "BEFORE_EXPOSURE"
  | "AFTER_FIX"
  | "INCONCLUSIVE_REVIEW_MANUALLY";

export type MembershipClassificationInput = {
  membershipCreatedAt: Date;
  windowSince: Date;
  windowUntil: Date;
  companyName: string;
  /** CompanyOrigin — string para não acoplar este módulo puro ao client Prisma gerado. */
  companyOrigin: string;
  invitedByUserId: string | null;
  /** true se existe CompanyClaimRequest com status APPROVED para este (company, user). */
  hasApprovedClaim: boolean;
  /** true se existe um AuditLog `company.claim_started` próximo do momento da membership. */
  hasClaimStartedAuditEvent: boolean;
  userCreatedAt: Date;
};

const NEAR_CREATION_WINDOW_MS = 60_000;

/**
 * Classifica UMA membership. A ordem dos checks importa (do mais para o
 * menos específico): fora da janela primeiro (nunca marca como suspeita algo
 * anterior à exposição ou posterior à correção, mesmo que o padrão coincida
 * por acaso), depois dado demonstrativo conhecido, depois convite explícito
 * (nunca alcançável pelo fluxo antigo nem pelo novo registro público),
 * depois os sinais de suspeita, depois aprovação de claim, e por último
 * inconclusivo — nunca "legítima" só porque a Company está CLAIMED hoje.
 */
export function classifyMembership(input: MembershipClassificationInput): MembershipClassification {
  if (input.membershipCreatedAt.getTime() < input.windowSince.getTime()) {
    return "BEFORE_EXPOSURE";
  }
  if (input.membershipCreatedAt.getTime() > input.windowUntil.getTime()) {
    return "AFTER_FIX";
  }

  if (looksLikeDemoData(input.companyName)) {
    return "SEED_OR_DEMO";
  }

  // Sinal forte de legitimidade: membership com convite explícito nunca
  // passa pelo fluxo público de registro (que nunca preenche
  // invitedByUserId) — nem o antigo (inseguro) nem o atual.
  if (input.invitedByUserId) {
    return "LEGITIMATE_INVITE";
  }

  // Sinal de alta suspeita: a Company tinha origem SST_PROVIDER (pré-
  // cadastrada por uma consultoria) — antes da correção, reivindicar uma
  // dessas concedia ADMIN instantâneo sobre dados potencialmente reais sem
  // NENHUMA comprovação.
  const isPreRegisteredClaim = input.companyOrigin === "SST_PROVIDER";
  const userCreatedNearMembership =
    Math.abs(input.userCreatedAt.getTime() - input.membershipCreatedAt.getTime()) < NEAR_CREATION_WINDOW_MS;

  if (isPreRegisteredClaim || input.hasClaimStartedAuditEvent || (!input.hasApprovedClaim && userCreatedNearMembership)) {
    return "SUSPICIOUS_INSECURE_FLOW";
  }

  if (input.hasApprovedClaim) {
    return "LEGITIMATE_CLAIM_APPROVED";
  }

  return "INCONCLUSIVE_REVIEW_MANUALLY";
}

export const MEMBERSHIP_CLASSIFICATION_LABELS: Record<MembershipClassification, string> = {
  SUSPICIOUS_INSECURE_FLOW: "Provavelmente criada pelo fluxo inseguro",
  LEGITIMATE_INVITE: "Convite empresarial legítimo",
  LEGITIMATE_CLAIM_APPROVED: "Aprovação de CompanyClaimRequest",
  SEED_OR_DEMO: "Seed ou dado demonstrativo",
  BEFORE_EXPOSURE: "Anterior à exposição",
  AFTER_FIX: "Posterior à correção",
  INCONCLUSIVE_REVIEW_MANUALLY: "Inconclusiva — revisar manualmente",
};
