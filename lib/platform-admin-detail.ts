import { prisma } from "@/lib/prisma";
import { maskCnpjForLog } from "@/lib/cnpj";

// Sprint SST 1.4D, §9 — dados para /platform-admin/company-claims/[id].
// Nunca inclui colaboradores/treinamentos/ativos/estoque/custódias/
// documentos/assinaturas/fotos/dados médicos — só o mínimo administrativo
// para decidir uma reivindicação.

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export type ClaimDetailForAdmin = {
  claim: {
    id: string;
    status: string;
    origin: string;
    requestedAt: Date;
    reviewedAt: Date | null;
    reviewedByUserId: string | null;
    rejectionReason: string | null;
  };
  company: {
    id: string;
    name: string;
    cnpjMasked: string | null;
    origin: string;
    controlStatus: string;
    createdAt: Date;
  };
  requester: {
    id: string;
    emailMasked: string;
    createdAt: Date;
  };
  /** Claims concorrentes da MESMA empresa — nunca inclui o e-mail/nome do
   * outro solicitante além do mínimo mascarado (§14: "não revelar um
   * solicitante ao outro" — aqui é visão do Super Admin, que precisa
   * comparar, mas ainda assim minimizado). */
  competingClaims: { id: string; status: string; requesterEmailMasked: string; requestedAt: Date }[];
  hasAdministrativeMembership: boolean;
  provisionalProvider: {
    providerNameMasked: string;
    createdAt: Date;
    accessLevel: string;
    status: string;
  } | null;
  /** Linha do tempo administrativa — só eventos de auditoria diretamente
   * relacionados a esta claim (nunca o AuditLog inteiro da empresa). */
  auditEvents: { id: string; action: string; createdAt: Date; actorName: string; metadata: unknown }[];
};

const RELEVANT_AUDIT_ACTIONS = [
  "company_claim.requested",
  "company_claim.request_reused",
  "company_claim.disputed",
  "company_claim.concurrent_request_detected",
  "company_claim.approved",
  "company_claim.rejected",
  "company_claim.cancelled",
  "company_claim.access_denied",
  "company_claim.invalid_transition",
  "platform_admin.claim_viewed",
  "platform_admin.claim_review_started",
  "platform_admin.claim_review_reassignment_blocked",
  "platform_admin.claim_approved",
  "platform_admin.claim_rejected",
  "platform_admin.invalid_claim_transition",
];

/** Mascara o nome administrativo mínimo de uma consultoria (§15: "nome
 * administrativo mínimo" — não é preciso mascarar como CNPJ/e-mail, mas
 * mantém o padrão de nunca expor mais do que necessário: só a primeira
 * palavra do nome fantasia, o resto abreviado). */
function maskProviderName(name: string): string {
  const [first, ...rest] = name.split(" ");
  if (rest.length === 0) return first;
  return `${first} ${"*".repeat(Math.min(rest.join(" ").length, 12))}`;
}

export async function getCompanyClaimDetailForAdmin(claimRequestId: string): Promise<ClaimDetailForAdmin | null> {
  const claim = await prisma.companyClaimRequest.findUnique({
    where: { id: claimRequestId },
    select: {
      id: true,
      status: true,
      origin: true,
      requestedAt: true,
      reviewedAt: true,
      reviewedByUserId: true,
      rejectionReason: true,
      companyId: true,
      requesterUserId: true,
      company: { select: { id: true, name: true, documentNormalized: true, origin: true, controlStatus: true, createdAt: true } },
      requester: { select: { id: true, email: true, createdAt: true } },
    },
  });
  if (!claim) return null;

  const [competing, membership, provisionalLink, auditEvents] = await Promise.all([
    prisma.companyClaimRequest.findMany({
      where: { companyId: claim.companyId, id: { not: claim.id } },
      select: { id: true, status: true, requestedAt: true, requester: { select: { email: true } } },
      orderBy: { requestedAt: "asc" },
    }),
    prisma.companyMembership.findFirst({
      where: { companyId: claim.companyId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.sstProviderCompany.findFirst({
      where: { companyId: claim.companyId, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE" },
      select: { createdAt: true, accessLevel: true, status: true, provider: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { companyId: claim.companyId, targetType: "CompanyClaimRequest", targetId: claim.id, action: { in: RELEVANT_AUDIT_ACTIONS } },
      select: { id: true, action: true, createdAt: true, actorName: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    claim: {
      id: claim.id,
      status: claim.status,
      origin: claim.origin,
      requestedAt: claim.requestedAt,
      reviewedAt: claim.reviewedAt,
      reviewedByUserId: claim.reviewedByUserId,
      rejectionReason: claim.rejectionReason,
    },
    company: {
      id: claim.company.id,
      name: claim.company.name,
      cnpjMasked: claim.company.documentNormalized ? maskCnpjForLog(claim.company.documentNormalized) : null,
      origin: claim.company.origin,
      controlStatus: claim.company.controlStatus,
      createdAt: claim.company.createdAt,
    },
    requester: {
      id: claim.requester.id,
      emailMasked: maskEmail(claim.requester.email),
      createdAt: claim.requester.createdAt,
    },
    competingClaims: competing.map((c) => ({
      id: c.id,
      status: c.status,
      requesterEmailMasked: maskEmail(c.requester.email),
      requestedAt: c.requestedAt,
    })),
    hasAdministrativeMembership: Boolean(membership),
    provisionalProvider: provisionalLink
      ? {
          providerNameMasked: maskProviderName(provisionalLink.provider.name),
          createdAt: provisionalLink.createdAt,
          accessLevel: provisionalLink.accessLevel,
          status: provisionalLink.status,
        }
      : null,
    auditEvents: auditEvents.map((e) => ({ id: e.id, action: e.action, createdAt: e.createdAt, actorName: e.actorName, metadata: e.metadata })),
  };
}
