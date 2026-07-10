import { unstable_cache, revalidateTag } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getDashboardAlertsSummary } from "@/lib/dashboard";
import { getStockSummary } from "@/lib/stock";

// Cache com `unstable_cache` + `revalidateTag` — o modelo de cache vigente
// nesta versão do Next quando `cacheComponents` NÃO está habilitado (não
// está, ver next.config.ts), conforme
// node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md.
// Migrar pra `"use cache"`/Cache Components seria uma mudança de arquitetura
// bem maior (exige Suspense em toda API dinâmica do app hoje) — fica de fora
// deste trabalho.
//
// Escopo: só dados lidos com muita frequência e que mudam pouco por
// requisição — resumo de alertas do Dashboard, totais agregados de estoque,
// listas de apoio de Relatórios (categoria/status/condição/local). NÃO
// cacheia as listagens paginadas em si (mudam a cada busca/filtro/página —
// cache não ajudaria e só complicaria invalidação).

const REVALIDATE_SECONDS = 60;

function companyTag(companyId: string, scope: "dashboard" | "stock" | "reports-lookups") {
  return `company:${companyId}:${scope}`;
}

/** Chama `revalidateTag` pros escopos indicados — centraliza as strings de
 * tag num único lugar (nunca espalhadas pelas rotas de mutação). Chamar após
 * qualquer escrita que afete o resumo do dashboard, os totais de estoque, ou
 * as listas de apoio de relatórios. */
export function invalidateCompanyData(
  companyId: string,
  scopes: Array<"dashboard" | "stock" | "reports-lookups">,
) {
  for (const scope of scopes) {
    // Nesta versão do Next, `revalidateTag` exige um 2º argumento de
    // "profile" — "max" reproduz a invalidação imediata do antigo
    // `revalidateTag(tag)` de um argumento só (ver mensagem de depreciação
    // em node_modules/next/dist/server/web/spec-extension/revalidate.js).
    // Chamado de rotas de API (nunca Server Actions), então `updateTag` não
    // é opção aqui.
    revalidateTag(companyTag(companyId, scope), "max");
  }
}

export function getCachedDashboardAlertsSummary(companyId: string) {
  return unstable_cache(
    () => getDashboardAlertsSummary(companyId),
    ["dashboard-alerts-summary", companyId],
    { tags: [companyTag(companyId, "dashboard")], revalidate: REVALIDATE_SECONDS },
  )();
}

export function getCachedStockSummary(companyId: string) {
  return unstable_cache(() => getStockSummary(companyId), ["stock-summary", companyId], {
    tags: [companyTag(companyId, "stock"), companyTag(companyId, "dashboard")],
    revalidate: REVALIDATE_SECONDS,
  })();
}

/** Listas de apoio (dropdowns de filtro) de Relatórios — categoria/status/
 * condição/local mudam raramente comparado à frequência de acesso à tela.
 * `employees`/`assets` NÃO entram aqui: em empresas com milhares de
 * registros esses dois já são grandes demais pra um <select> simples virar
 * uma boa UX — fica registrado como limitação conhecida em
 * docs/performance.md, não resolvido nesta entrega. */
export function getCachedReportLookups(companyId: string) {
  return unstable_cache(
    async () => {
      const [categories, statuses, conditions, locations] = await Promise.all([
        prisma.assetCategory.findMany({
          where: { companyId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.assetStatus.findMany({
          where: { companyId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.assetCondition.findMany({
          where: { companyId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.location.findMany({
          where: { companyId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);
      return { categories, statuses, conditions, locations };
    },
    ["reports-lookups", companyId],
    { tags: [companyTag(companyId, "reports-lookups")], revalidate: REVALIDATE_SECONDS },
  )();
}
