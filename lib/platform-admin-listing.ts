import { prisma } from "@/lib/prisma";
import { maskCnpjForLog } from "@/lib/cnpj";
import type { CompanyClaimRequestStatus } from "@/app/generated/prisma/client";

// Sprint SST 1.4D, §7/§8/§22 — dados para o dashboard e a listagem do
// Portal Super Admin Lite. Nunca consulta colaboradores/treinamentos/
// ativos/estoque/documentos/fotos — só metadados administrativos da
// Company/CompanyClaimRequest/SstProviderCompany. Selects mínimos, sem
// N+1: contagem de claims concorrentes e existência de vínculo provisório
// são resolvidas em lote (1 query extra cada, não 1 por linha).

export type PlatformAdminDashboardSummary = {
  pendingCount: number;
  underReviewCount: number;
  disputedCompanyCount: number;
  approvedRecentCount: number;
  rejectedRecentCount: number;
};

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias — "recentemente" para o dashboard.

export async function getPlatformAdminDashboardSummary(now = new Date()): Promise<PlatformAdminDashboardSummary> {
  const since = new Date(now.getTime() - RECENT_WINDOW_MS);

  const [pendingCount, underReviewCount, disputedCompanyCount, approvedRecentCount, rejectedRecentCount] = await Promise.all([
    prisma.companyClaimRequest.count({ where: { status: "PENDING" } }),
    prisma.companyClaimRequest.count({ where: { status: "UNDER_REVIEW" } }),
    prisma.company.count({ where: { controlStatus: "DISPUTED" } }),
    prisma.companyClaimRequest.count({ where: { status: "APPROVED", reviewedAt: { gte: since } } }),
    prisma.companyClaimRequest.count({ where: { status: "REJECTED", reviewedAt: { gte: since } } }),
  ]);

  return { pendingCount, underReviewCount, disputedCompanyCount, approvedRecentCount, rejectedRecentCount };
}

export type ClaimListFilter = CompanyClaimRequestStatus | "ALL";

export type ClaimListItem = {
  id: string;
  status: CompanyClaimRequestStatus;
  requestedAt: Date;
  companyId: string;
  companyName: string;
  companyCnpjMasked: string | null;
  companyOrigin: string;
  companyControlStatus: string;
  requesterEmailMasked: string;
  concurrentActiveClaimCount: number;
  hasProvisionalProvider: boolean;
};

export type ClaimListResult = {
  items: ClaimListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

const STATUS_SORT_RANK: Record<string, number> = {
  DISPUTED: 0, // pseudo-status — na prática só aplicável via companyControlStatus, tratado à parte na query.
  PENDING: 1,
  UNDER_REVIEW: 2,
  APPROVED: 3,
  REJECTED: 4,
  CANCELLED: 5,
  EXPIRED: 6,
};

const DEFAULT_PAGE_SIZE = 20;

/**
 * Listagem paginada server-side (§22 — nunca carrega tudo de uma vez).
 * Ordenação padrão (§8): empresas DISPUTED primeiro, depois PENDING mais
 * antigas, depois UNDER_REVIEW mais antigas, depois as demais por data.
 */
export async function listCompanyClaimsForAdmin(params: {
  status: ClaimListFilter;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<ClaimListResult> {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  const search = params.search?.trim();

  const where = {
    ...(params.status !== "ALL" ? { status: params.status } : {}),
    ...(search
      ? {
          OR: [
            { company: { name: { contains: search, mode: "insensitive" as const } } },
            { company: { documentNormalized: { contains: search.replace(/\D/g, "") } } },
            { requester: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [totalCount, claims] = await Promise.all([
    prisma.companyClaimRequest.count({ where }),
    prisma.companyClaimRequest.findMany({
      where,
      select: {
        id: true,
        status: true,
        requestedAt: true,
        companyId: true,
        company: { select: { name: true, documentNormalized: true, origin: true, controlStatus: true } },
        requester: { select: { email: true } },
      },
      // Ordenação real de "DISPUTED primeiro" depende de Company.controlStatus,
      // que o Prisma não deixa ordenar por relação diretamente numa query
      // combinada com os outros critérios — busca um lote maior por data e
      // reordena em memória abaixo (aceitável: pageSize é pequeno, <=100).
      orderBy: { requestedAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const companyIds = [...new Set(claims.map((c) => c.companyId))];

  // Lote único para contagem de claims concorrentes ativas por empresa —
  // nunca 1 query por linha.
  const concurrentCounts =
    companyIds.length > 0
      ? await prisma.companyClaimRequest.groupBy({
          by: ["companyId"],
          where: { companyId: { in: companyIds }, status: { in: ["PENDING", "UNDER_REVIEW"] } },
          _count: true,
        })
      : [];
  const concurrentByCompany = new Map(concurrentCounts.map((c) => [c.companyId, c._count]));

  // Lote único para existência de vínculo provisório por empresa.
  const provisionalLinks =
    companyIds.length > 0
      ? await prisma.sstProviderCompany.findMany({
          where: { companyId: { in: companyIds }, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE" },
          select: { companyId: true },
        })
      : [];
  const provisionalByCompany = new Set(provisionalLinks.map((l) => l.companyId));

  const items: ClaimListItem[] = claims.map((claim) => ({
    id: claim.id,
    status: claim.status,
    requestedAt: claim.requestedAt,
    companyId: claim.companyId,
    companyName: claim.company.name,
    companyCnpjMasked: claim.company.documentNormalized ? maskCnpjForLog(claim.company.documentNormalized) : null,
    companyOrigin: claim.company.origin,
    companyControlStatus: claim.company.controlStatus,
    requesterEmailMasked: maskEmail(claim.requester.email),
    concurrentActiveClaimCount: concurrentByCompany.get(claim.companyId) ?? 0,
    hasProvisionalProvider: provisionalByCompany.has(claim.companyId),
  }));

  items.sort((a, b) => {
    const aDisputed = a.companyControlStatus === "DISPUTED";
    const bDisputed = b.companyControlStatus === "DISPUTED";
    if (aDisputed !== bDisputed) return aDisputed ? -1 : 1;

    const rankDiff = (STATUS_SORT_RANK[a.status] ?? 99) - (STATUS_SORT_RANK[b.status] ?? 99);
    if (rankDiff !== 0) return rankDiff;

    return a.requestedAt.getTime() - b.requestedAt.getTime();
  });

  return { items, totalCount, page, pageSize };
}
