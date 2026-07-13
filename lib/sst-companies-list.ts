import type { CompanyTrainingMetrics, SstComplianceStatus } from "@/lib/sst-dashboard";
import { pluralize } from "@/lib/plural";

// Lógica de apresentação da carteira de empresas do Portal Consultoria
// (Sprint Demo Comercial SST 1.3) extraída para cá — pura, sem React — para
// poder ser testada diretamente (a suíte deste projeto não usa
// jsdom/@testing-library/react, ver tests/dashboard-nav-reorganization.test.ts).
// Nunca recalcula `complianceStatus`/`complianceScore` (Parte 10): só decide
// que TEXTO mostrar a partir dos números já calculados por lib/sst-dashboard.ts.

export function hasPendency(company: CompanyTrainingMetrics): boolean {
  return company.expiredCount > 0 || company.missingMandatoryCount > 0 || company.expiringSoonCount > 0;
}

export type CompanyListFilters = {
  search: string;
  statusFilter: SstComplianceStatus | "ALL";
  onlyWithPendency: boolean;
};

/**
 * Aplica busca (por nome, case-insensitive) + filtro de situação + filtro de
 * pendências sobre uma lista já ordenada e já escopada à consultoria
 * autenticada — nunca amplia o conjunto recebido, só remove itens (Parte 13:
 * "a busca nunca pode retornar empresa de outra consultoria" — garantido
 * aqui por construção, já que `companies` só entra pré-filtrado por
 * `getLinkedCompaniesWithMetrics`). `Array.prototype.filter` preserva a
 * ordem relativa, então o resultado nunca perde a ordenação padrão (Parte
 * 5: "busca, filtros e paginação devem preservar uma ordem previsível").
 */
export function filterCompaniesForList<T extends CompanyTrainingMetrics>(
  companies: T[],
  filters: CompanyListFilters,
): T[] {
  const normalizedSearch = filters.search.trim().toLowerCase();
  return companies.filter((company) => {
    if (normalizedSearch && !company.companyName.toLowerCase().includes(normalizedSearch)) return false;
    if (filters.statusFilter !== "ALL" && company.complianceStatus !== filters.statusFilter) return false;
    if (filters.onlyWithPendency && !hasPendency(company)) return false;
    return true;
  });
}

/**
 * Linha de resumo principal (Parte 7/8): colaboradores sem treinamento
 * obrigatório + treinamentos vencidos, cada um só aparece se > 0; se ambos
 * forem zero, mostra a mensagem resumida em vez de uma sequência de zeros.
 */
export function buildPendencySummary(company: CompanyTrainingMetrics): string {
  const parts: string[] = [];
  if (company.missingMandatoryCount > 0) {
    parts.push(`${company.missingMandatoryCount} com treinamento pendente`);
  }
  if (company.expiredCount > 0) {
    parts.push(pluralize(company.expiredCount, "treinamento vencido", "treinamentos vencidos"));
  }
  if (parts.length === 0) return "Nenhuma pendência de treinamento.";
  return parts.join(" · ");
}

/**
 * Informações secundárias (Parte 7): vencendo em 30 dias, turmas agendadas,
 * treinamentos cadastrados — cada uma só aparece quando > 0 (Parte 8: "não
 * mostrar sequências de zeros"). Retorna a lista de fragmentos já formatados;
 * o chamador decide se junta ou omite a linha inteira quando vazia.
 */
export function buildSecondaryInfo(company: CompanyTrainingMetrics): string[] {
  const parts: string[] = [];
  if (company.expiringSoonCount > 0) {
    parts.push(
      pluralize(company.expiringSoonCount, "treinamento vencendo em 30 dias", "treinamentos vencendo em 30 dias"),
    );
  }
  if (company.scheduledClassCount > 0) {
    parts.push(pluralize(company.scheduledClassCount, "turma agendada", "turmas agendadas"));
  }
  if (company.activeTrainingCount > 0) {
    parts.push(pluralize(company.activeTrainingCount, "treinamento cadastrado", "treinamentos cadastrados"));
  }
  return parts;
}
