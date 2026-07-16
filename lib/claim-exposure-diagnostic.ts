import { prisma } from "@/lib/prisma";
import { maskCnpjForLog } from "@/lib/cnpj";
import { classifyMembership, type MembershipClassification } from "@/lib/claim-exposure-classifier";
import { logPlatformAudit } from "@/lib/platform-audit";

// Sprint SST 1.4D.2 — núcleo de consulta do diagnóstico de exposição,
// extraído de scripts/diagnose-claim-flow-exposure.ts para ser testável sem
// spawnar o script como subprocesso (mesmo padrão de
// lib/claim-exposure-timestamp.ts / lib/claim-exposure-classifier.ts). O
// script continua sendo só a casca de CLI (parse de argumentos, impressão
// formatada, process.exit) — toda leitura de banco e toda escrita de
// auditoria vivem aqui, onde um teste de integração consegue chamar
// diretamente e conferir precisamente quais tabelas foram tocadas.
//
// Garantia central (testada em tests/tenant-isolation/platform-audit.test.ts
// e tests/tenant-isolation/claim-exposure-diagnostic.test.ts): a ÚNICA
// escrita realizada por este módulo é o INSERT append-only em
// PlatformAuditLog feito por `recordExposureDiagnosticExecuted` — nunca
// UPDATE/DELETE/INSERT em Company, User, CompanyMembership,
// CompanyClaimRequest, SstProviderCompany ou UserRole. `runExposureDiagnosticQuery`
// abaixo é 100% leitura (só `findMany`/`findFirst`/`findUnique`).

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export type ManualReviewEntry = {
  membershipId: string;
  classification: Extract<MembershipClassification, "SUSPICIOUS_INSECURE_FLOW" | "INCONCLUSIVE_REVIEW_MANUALLY">;
  companyId: string;
  companyName: string;
  companyOrigin: string;
  companyControlStatus: string;
  cnpjMasked: string | null;
  userId: string;
  emailMasked: string;
  membershipCreatedAt: Date;
  userCreatedAt: Date;
  hasClaimStartedAuditEvent: boolean;
  claimRequestStatus: string | null;
};

export type ExposureDiagnosticResult = {
  totalActiveMemberships: number;
  counts: Record<MembershipClassification, number>;
  manualReviewEntries: ManualReviewEntry[];
};

/**
 * Consulta e classifica todas as CompanyMembership ACTIVE do sistema em
 * relação à janela informada — SOMENTE LEITURA (nenhum `create`/`update`/
 * `delete` em nenhuma chamada Prisma deste módulo). Nunca revoga/corrige
 * nada automaticamente.
 */
export async function runExposureDiagnosticQuery(since: Date, until: Date): Promise<ExposureDiagnosticResult> {
  const allMemberships = await prisma.companyMembership.findMany({
    where: { status: "ACTIVE" },
    include: {
      user: { select: { id: true, email: true, createdAt: true } },
      company: { select: { id: true, name: true, origin: true, controlStatus: true, documentNormalized: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const counts: Record<MembershipClassification, number> = {
    SUSPICIOUS_INSECURE_FLOW: 0,
    LEGITIMATE_INVITE: 0,
    LEGITIMATE_CLAIM_APPROVED: 0,
    SEED_OR_DEMO: 0,
    BEFORE_EXPOSURE: 0,
    AFTER_FIX: 0,
    INCONCLUSIVE_REVIEW_MANUALLY: 0,
  };

  const manualReviewEntries: ManualReviewEntry[] = [];

  for (const membership of allMemberships) {
    if (membership.createdAt.getTime() < since.getTime() || membership.createdAt.getTime() > until.getTime()) {
      const classification = classifyMembership({
        membershipCreatedAt: membership.createdAt,
        windowSince: since,
        windowUntil: until,
        companyName: membership.company.name,
        companyOrigin: membership.company.origin,
        invitedByUserId: membership.invitedByUserId,
        hasApprovedClaim: false,
        hasClaimStartedAuditEvent: false,
        userCreatedAt: membership.user.createdAt,
      });
      counts[classification] += 1;
      continue;
    }

    const claimStartedEvent = await prisma.auditLog.findFirst({
      where: {
        companyId: membership.companyId,
        action: "company.claim_started",
        createdAt: { gte: new Date(membership.createdAt.getTime() - 60_000), lte: new Date(membership.createdAt.getTime() + 60_000) },
      },
    });
    const claimRequest = await prisma.companyClaimRequest.findUnique({
      where: { companyId_requesterUserId: { companyId: membership.companyId, requesterUserId: membership.userId } },
    });
    const hasApprovedClaim = claimRequest?.status === "APPROVED";

    const classification = classifyMembership({
      membershipCreatedAt: membership.createdAt,
      windowSince: since,
      windowUntil: until,
      companyName: membership.company.name,
      companyOrigin: membership.company.origin,
      invitedByUserId: membership.invitedByUserId,
      hasApprovedClaim,
      hasClaimStartedAuditEvent: Boolean(claimStartedEvent),
      userCreatedAt: membership.user.createdAt,
    });
    counts[classification] += 1;

    if (classification === "SUSPICIOUS_INSECURE_FLOW" || classification === "INCONCLUSIVE_REVIEW_MANUALLY") {
      manualReviewEntries.push({
        membershipId: membership.id,
        classification,
        companyId: membership.company.id,
        companyName: membership.company.name,
        companyOrigin: membership.company.origin,
        companyControlStatus: membership.company.controlStatus,
        cnpjMasked: membership.company.documentNormalized ? maskCnpjForLog(membership.company.documentNormalized) : null,
        userId: membership.user.id,
        emailMasked: maskEmail(membership.user.email),
        membershipCreatedAt: membership.createdAt,
        userCreatedAt: membership.user.createdAt,
        hasClaimStartedAuditEvent: Boolean(claimStartedEvent),
        claimRequestStatus: claimRequest?.status ?? null,
      });
    }
  }

  return { totalActiveMemberships: allMemberships.length, counts, manualReviewEntries };
}

/**
 * Persiste que o diagnóstico foi executado (Sprint SST 1.4D.1, §17) — a
 * ÚNICA escrita de todo o diagnóstico, um INSERT append-only em
 * PlatformAuditLog. Nunca inclui CNPJ/e-mail nos metadados, só a janela
 * (datas). Best-effort: falha ao persistir nunca bloqueia o diagnóstico.
 */
export async function recordExposureDiagnosticExecuted(since: Date, until: Date): Promise<void> {
  await logPlatformAudit({
    action: "platform_admin.exposure_diagnostic_executed",
    severity: "INFO",
    source: "CLI",
    metadata: { since: since.toISOString(), until: until.toISOString() },
  }).catch(() => {
    // Nunca bloqueia o diagnóstico por falha ao persistir o próprio
    // registro de auditoria — best-effort, mesmo padrão de logAudit() em
    // pontos não-transacionais deste projeto.
  });
}
