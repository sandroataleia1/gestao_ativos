import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestEmployee,
  createTestProvider,
  linkProviderToCompany,
  prisma,
} from "@/tests/helpers/db";

// Sprint Demo Comercial SST 1.3 — testes de escopo/dados da carteira de
// empresas (itens 8, 9, 13 da Parte 20). Os itens de ordenação/pluralização/
// texto (1-7, 10-12, 14, 16) são testes puros sem banco, ver
// tests/sst-companies-list.test.ts. Item 15 (idempotência do seed com os
// novos nomes) também está lá, reaproveitando `seedSstDemo()`.

const companyIds: string[] = [];
const providerIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

describe("Sprint Demo Comercial SST 1.3 — escopo da carteira de empresas", () => {
  it("caso 1: empresa sem vínculo ACTIVE não aparece na carteira ordenada", async () => {
    const { getLinkedCompaniesWithMetrics } = await import("@/lib/sst-dashboard");

    const provider = await createTestProvider("list13-no-active");
    providerIds.push(provider.id);
    const activeCompany = await createTestCompany("list13-active");
    const revokedCompany = await createTestCompany("list13-revoked");
    companyIds.push(activeCompany.id, revokedCompany.id);

    await createTestEmployee(activeCompany.id, "list13-active-emp");
    await createTestEmployee(revokedCompany.id, "list13-revoked-emp");

    await linkProviderToCompany({ providerId: provider.id, companyId: activeCompany.id, status: "ACTIVE" });
    await linkProviderToCompany({ providerId: provider.id, companyId: revokedCompany.id, status: "REVOKED" });

    const companies = await getLinkedCompaniesWithMetrics(provider.id);
    const ids = companies.map((c) => c.companyId);
    expect(ids).toContain(activeCompany.id);
    expect(ids).not.toContain(revokedCompany.id);
  });

  it("caso 2: empresa vinculada a outra consultoria não vaza para esta carteira", async () => {
    const { getLinkedCompaniesWithMetrics } = await import("@/lib/sst-dashboard");

    const providerA = await createTestProvider("list13-scope-a");
    const providerB = await createTestProvider("list13-scope-b");
    providerIds.push(providerA.id, providerB.id);
    const companyA = await createTestCompany("list13-scope-company-a");
    const companyB = await createTestCompany("list13-scope-company-b");
    companyIds.push(companyA.id, companyB.id);

    await linkProviderToCompany({ providerId: providerA.id, companyId: companyA.id, status: "ACTIVE" });
    await linkProviderToCompany({ providerId: providerB.id, companyId: companyB.id, status: "ACTIVE" });

    const companiesForA = await getLinkedCompaniesWithMetrics(providerA.id);
    const idsForA = companiesForA.map((c) => c.companyId);
    expect(idsForA).toContain(companyA.id);
    expect(idsForA).not.toContain(companyB.id);
  });

  it("caso 3: nível de acesso exibido corresponde exatamente ao vínculo real (SstProviderCompany.accessLevel)", async () => {
    const { getLinkedCompaniesWithMetrics } = await import("@/lib/sst-dashboard");

    const provider = await createTestProvider("list13-access-level");
    providerIds.push(provider.id);
    const company = await createTestCompany("list13-access-level-co");
    companyIds.push(company.id);

    await linkProviderToCompany({
      providerId: provider.id,
      companyId: company.id,
      status: "ACTIVE",
      accessLevel: "ADMINISTRATION",
    });

    const companies = await getLinkedCompaniesWithMetrics(provider.id);
    const summary = companies.find((c) => c.companyId === company.id);
    expect(summary?.accessLevel).toBe("ADMINISTRATION");
  });
});
