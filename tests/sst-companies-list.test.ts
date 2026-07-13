import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sortCompaniesForConsultancyList, calculateSstComplianceScore, classifySstComplianceStatus } from "@/lib/sst-dashboard";
import type { CompanyTrainingMetrics } from "@/lib/sst-dashboard";
import { buildPendencySummary, buildSecondaryInfo, filterCompaniesForList, hasPendency } from "@/lib/sst-companies-list";

// Sprint Demo Comercial SST 1.3 — testes puros (sem banco) para a carteira
// de empresas do Portal Consultoria. Segue o mesmo padrão de
// tests/dashboard-nav-reorganization.test.ts: comportamento/lógica
// exportada, não texto renderizado frágil. O caso 15 (idempotência do seed
// com os novos nomes humanos) está em
// tests/tenant-isolation/sst-dashboard-scope-and-seed.test.ts, que já tem o
// ciclo de vida completo de limpeza do seed de demonstração — duplicar esse
// ciclo aqui arriscaria deixar dados de demo órfãos no banco de teste.

function makeCompany(overrides: Partial<CompanyTrainingMetrics> & { companyId: string; companyName: string }): CompanyTrainingMetrics {
  return {
    activeEmployeeCount: 0,
    activeTrainingCount: 0,
    scheduledClassCount: 0,
    inProgressClassCount: 0,
    classesTodayCount: 0,
    classesThisWeekCount: 0,
    expiredCount: 0,
    expiringSoonCount: 0,
    missingMandatoryCount: 0,
    complianceScore: 100,
    complianceStatus: "EM_DIA",
    ...overrides,
  };
}

describe("Sprint Demo Comercial SST 1.3 — caso 1/2: ordenação padrão da carteira", () => {
  it("crítica aparece antes de atenção, que aparece antes de em dia", () => {
    const companies = [
      makeCompany({ companyId: "1", companyName: "Em dia Co", complianceStatus: "EM_DIA" }),
      makeCompany({ companyId: "2", companyName: "Atenção Co", complianceStatus: "ATENCAO", expiringSoonCount: 1 }),
      makeCompany({ companyId: "3", companyName: "Crítica Co", complianceStatus: "CRITICA", expiredCount: 1 }),
    ];
    const sorted = sortCompaniesForConsultancyList(companies);
    expect(sorted.map((c) => c.companyId)).toEqual(["3", "2", "1"]);
  });

  it("dentro do mesmo nível, ordena por maior total de pendências, depois mais vencidos, depois menor conformidade, depois nome", () => {
    const companies = [
      makeCompany({
        companyId: "low-pendency",
        companyName: "Zeta",
        complianceStatus: "CRITICA",
        expiredCount: 1,
        missingMandatoryCount: 1,
        complianceScore: 70,
      }),
      makeCompany({
        companyId: "high-pendency",
        companyName: "Alfa",
        complianceStatus: "CRITICA",
        expiredCount: 2,
        missingMandatoryCount: 3,
        complianceScore: 30,
      }),
    ];
    const sorted = sortCompaniesForConsultancyList(companies);
    // high-pendency tem 5 pendências (2+3) vs 2 (1+1) do low-pendency —
    // maior total de pendências vem primeiro, mesmo com nome "depois" no
    // alfabeto.
    expect(sorted.map((c) => c.companyId)).toEqual(["high-pendency", "low-pendency"]);
  });

  it("com pendências totais iguais, desempata por mais vencidos", () => {
    const companies = [
      makeCompany({
        companyId: "mais-missing",
        companyName: "Beta",
        complianceStatus: "CRITICA",
        expiredCount: 0,
        missingMandatoryCount: 3,
        complianceScore: 55,
      }),
      makeCompany({
        companyId: "mais-vencido",
        companyName: "Alfa",
        complianceStatus: "CRITICA",
        expiredCount: 3,
        missingMandatoryCount: 0,
        complianceScore: 70,
      }),
    ];
    const sorted = sortCompaniesForConsultancyList(companies);
    expect(sorted.map((c) => c.companyId)).toEqual(["mais-vencido", "mais-missing"]);
  });

  it("com pendências e vencidos iguais, desempata por menor conformidade", () => {
    const companies = [
      makeCompany({
        companyId: "score-alto",
        companyName: "Alfa",
        complianceStatus: "ATENCAO",
        expiringSoonCount: 1,
        complianceScore: 90,
      }),
      makeCompany({
        companyId: "score-baixo",
        companyName: "Beta",
        complianceStatus: "ATENCAO",
        expiringSoonCount: 1,
        complianceScore: 40,
      }),
    ];
    const sorted = sortCompaniesForConsultancyList(companies);
    expect(sorted.map((c) => c.companyId)).toEqual(["score-baixo", "score-alto"]);
  });

  it("com tudo empatado, desempata por nome em ordem alfabética (nunca pela ordem de entrada)", () => {
    const companies = [
      makeCompany({ companyId: "z", companyName: "Zeta Ltda", complianceStatus: "EM_DIA" }),
      makeCompany({ companyId: "a", companyName: "Alfa Ltda", complianceStatus: "EM_DIA" }),
      makeCompany({ companyId: "m", companyName: "Metalúrgica Ltda", complianceStatus: "EM_DIA" }),
    ];
    const sorted = sortCompaniesForConsultancyList(companies);
    expect(sorted.map((c) => c.companyId)).toEqual(["a", "m", "z"]);
  });

  it("a ordenação é determinística e nunca depende da ordem de entrada (mesmo conjunto embaralhado dá o mesmo resultado)", () => {
    const base = [
      makeCompany({ companyId: "1", companyName: "Um", complianceStatus: "CRITICA", expiredCount: 2 }),
      makeCompany({ companyId: "2", companyName: "Dois", complianceStatus: "ATENCAO", expiringSoonCount: 1 }),
      makeCompany({ companyId: "3", companyName: "Três", complianceStatus: "EM_DIA" }),
    ];
    const resultA = sortCompaniesForConsultancyList(base).map((c) => c.companyId);
    const resultB = sortCompaniesForConsultancyList([...base].reverse()).map((c) => c.companyId);
    expect(resultA).toEqual(resultB);
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 5/6: métricas zeradas não poluem a linha", () => {
  it("empresa sem nenhuma pendência mostra a mensagem resumida, não uma sequência de zeros", () => {
    const company = makeCompany({ companyId: "1", companyName: "Sem pendência Co" });
    expect(buildPendencySummary(company)).toBe("Nenhuma pendência de treinamento.");
  });

  it("empresa com só uma pendência mostra apenas o dado relevante", () => {
    const onlyMissing = makeCompany({ companyId: "1", companyName: "Co", missingMandatoryCount: 3 });
    expect(buildPendencySummary(onlyMissing)).toBe("3 com treinamento pendente");

    const onlyExpired = makeCompany({ companyId: "2", companyName: "Co", expiredCount: 1 });
    expect(buildPendencySummary(onlyExpired)).toBe("1 treinamento vencido");
  });

  it("empresa com as duas pendências junta os dois fragmentos", () => {
    const company = makeCompany({ companyId: "1", companyName: "Co", missingMandatoryCount: 3, expiredCount: 2 });
    expect(buildPendencySummary(company)).toBe("3 com treinamento pendente · 2 treinamentos vencidos");
  });

  it("informações secundárias zeradas não aparecem (lista vazia, não zeros)", () => {
    const company = makeCompany({ companyId: "1", companyName: "Co" });
    expect(buildSecondaryInfo(company)).toEqual([]);
  });

  it("informações secundárias só mostram o que é maior que zero", () => {
    const company = makeCompany({ companyId: "1", companyName: "Co", scheduledClassCount: 1 });
    expect(buildSecondaryInfo(company)).toEqual(["1 turma agendada"]);
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 7: conformidade mantém o cálculo já existente", () => {
  it("calculateSstComplianceScore/classifySstComplianceStatus continuam com os mesmos valores conhecidos", () => {
    expect(calculateSstComplianceScore({ expiredCount: 0, missingMandatoryCount: 0, expiringSoonCount: 0 })).toBe(100);
    expect(calculateSstComplianceScore({ expiredCount: 1, missingMandatoryCount: 0, expiringSoonCount: 0 })).toBe(90);
    expect(calculateSstComplianceScore({ expiredCount: 0, missingMandatoryCount: 1, expiringSoonCount: 0 })).toBe(85);
    expect(classifySstComplianceStatus({ expiredCount: 1, missingMandatoryCount: 0, expiringSoonCount: 0 })).toBe("CRITICA");
    expect(classifySstComplianceStatus({ expiredCount: 0, missingMandatoryCount: 0, expiringSoonCount: 1 })).toBe("ATENCAO");
    expect(classifySstComplianceStatus({ expiredCount: 0, missingMandatoryCount: 0, expiringSoonCount: 0 })).toBe("EM_DIA");
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 10/12: filtro de pendências e busca nunca ampliam o conjunto", () => {
  const companies = [
    makeCompany({ companyId: "1", companyName: "Metalúrgica Alfa", complianceStatus: "EM_DIA" }),
    makeCompany({ companyId: "2", companyName: "Construtora Beta", complianceStatus: "CRITICA", missingMandatoryCount: 2 }),
    makeCompany({ companyId: "3", companyName: "Transportadora Gama", complianceStatus: "ATENCAO", expiringSoonCount: 4 }),
  ];

  it("hasPendency reflete vencidos, sem treinamento obrigatório ou vencendo em 30 dias", () => {
    expect(hasPendency(companies[0])).toBe(false);
    expect(hasPendency(companies[1])).toBe(true);
    expect(hasPendency(companies[2])).toBe(true);
  });

  it("filtro 'somente com pendências' nunca inclui uma empresa sem pendência", () => {
    const filtered = filterCompaniesForList(companies, { search: "", statusFilter: "ALL", onlyWithPendency: true });
    expect(filtered.map((c) => c.companyId)).toEqual(["2", "3"]);
  });

  it("busca por nome é case-insensitive e nunca retorna empresa fora do conjunto recebido", () => {
    const filtered = filterCompaniesForList(companies, { search: "beta", statusFilter: "ALL", onlyWithPendency: false });
    expect(filtered.map((c) => c.companyId)).toEqual(["2"]);
    for (const company of filtered) {
      expect(companies.map((c) => c.companyId)).toContain(company.companyId);
    }
  });

  it("busca preserva a ordem relativa recebida (nunca reordena)", () => {
    const filtered = filterCompaniesForList(companies, { search: "a", statusFilter: "ALL", onlyWithPendency: false });
    // "Metalúrgica Alfa", "Construtora Beta", "Transportadora Gama" todas
    // contêm "a" — a ordem do array de entrada deve ser preservada.
    expect(filtered.map((c) => c.companyId)).toEqual(["1", "2", "3"]);
  });

  it("filtro de situação isolado retorna só o status pedido", () => {
    const filtered = filterCompaniesForList(companies, { search: "", statusFilter: "CRITICA", onlyWithPendency: false });
    expect(filtered.map((c) => c.companyId)).toEqual(["2"]);
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 4: sem pluralização informal '(s)' no código-fonte da tela", () => {
  it("companies-list.tsx e company-list-item.tsx não usam mais o padrão '(s)'/'(es)'", () => {
    const listSource = readFileSync("app/sst/(portal)/companies/companies-list.tsx", "utf8");
    const itemSource = readFileSync("app/sst/(portal)/companies/company-list-item.tsx", "utf8");
    for (const source of [listSource, itemSource]) {
      expect(source).not.toMatch(/\(s\)|\(es\)/);
    }
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 11: filtro ativo tem indicação textual/semântica, não só cor", () => {
  it("o botão de pendências usa aria-pressed e um ícone de confirmação, não só a cor do botão", () => {
    const listSource = readFileSync("app/sst/(portal)/companies/companies-list.tsx", "utf8");
    expect(listSource).toContain("aria-pressed={onlyWithPendency}");
    expect(listSource).toContain("CheckIcon");
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 14: botão 'Abrir empresa' só linka para a empresa autorizada do item", () => {
  it("o href é construído a partir de company.companyId (o item já vem escopado pelo servidor), não de um valor externo", () => {
    const itemSource = readFileSync("app/sst/(portal)/companies/company-list-item.tsx", "utf8");
    expect(itemSource).toContain("`/sst/companies/${company.companyId}`");
    expect(itemSource).toContain("aria-label={`Abrir empresa ${company.companyName}`}");
  });
});

describe("Sprint Demo Comercial SST 1.3 — caso 16: Portal Empresa não foi afetado por esta sprint", () => {
  it("nenhum arquivo do Portal Empresa importa os módulos novos desta sprint", () => {
    const newModules = ["@/lib/sst-companies-list", "@/lib/plural", "./company-list-item"];
    const filesToCheck = [
      "app/(app)/dashboard/page.tsx",
      "app/(app)/layout.tsx",
      "components/layout/sidebar.tsx",
      "components/layout/header.tsx",
    ];
    for (const file of filesToCheck) {
      const source = readFileSync(file, "utf8");
      for (const moduleName of newModules) {
        expect(source).not.toContain(moduleName);
      }
    }
  });
});

