import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestMembership,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { resolveCompanyContext } from "@/lib/company-context";
import type { CompanyMembershipStatus } from "@/app/generated/prisma/client";

// Testes do resolver PURO (lib/company-context.ts) — sem sessão, sem
// next/headers, sem rota: chamada direta à função com entradas explícitas.
// Ver Sprint 0.5, Parte H.

const companyIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeUserWithCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  const user = await createTestUser(company.id, label);
  return { company, user };
}

describe("resolveCompanyContext — com requestedCompanyId", () => {
  it("caso 1: membership ACTIVE resolve com source REQUESTED", async () => {
    const { company, user } = await makeUserWithCompany("res-req-active");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.companyId).toBe(company.id);
      expect(result.source).toBe("REQUESTED");
      expect(result.membershipId).toBeTruthy();
    }
  });

  it("caso 2: sem nenhuma membership retorna contexto inválido", async () => {
    const { company, user } = await makeUserWithCompany("res-req-none");

    const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

    expect(result.status).toBe("INVALID_REQUESTED_CONTEXT");
  });

  for (const status of ["REVOKED", "SUSPENDED", "INVITED"] as const satisfies readonly CompanyMembershipStatus[]) {
    it(`caso 3-5: membership ${status} é negada (contexto inválido, sem distinguir o motivo)`, async () => {
      const { company, user } = await makeUserWithCompany(`res-req-${status.toLowerCase()}`);
      await createTestMembership({ userId: user.id, companyId: company.id, status });

      const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

      expect(result.status).toBe("INVALID_REQUESTED_CONTEXT");
    });
  }

  it("caso 6: requestedCompanyId inválido NÃO cai para a empresa legada", async () => {
    const { company: legacyCompany, user } = await makeUserWithCompany("res-req-invalid-legacy");
    await createTestMembership({ userId: user.id, companyId: legacyCompany.id, status: "ACTIVE" });

    const otherCompany = await createTestCompany("res-req-invalid-other");
    companyIds.push(otherCompany.id);
    // user não tem NENHUMA membership para otherCompany.

    const result = await resolveCompanyContext({
      userId: user.id,
      legacyCompanyId: legacyCompany.id,
      requestedCompanyId: otherCompany.id,
    });

    expect(result.status).toBe("INVALID_REQUESTED_CONTEXT");
    // Nunca "cai" silenciosamente para legacyCompany.
  });
});

describe("resolveCompanyContext — sem requestedCompanyId", () => {
  it("caso 7: membership legada ACTIVE resolve com source LEGACY", async () => {
    const { company, user } = await makeUserWithCompany("res-legacy-active");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const result = await resolveCompanyContext({ userId: user.id, legacyCompanyId: company.id });

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.companyId).toBe(company.id);
      expect(result.source).toBe("LEGACY");
    }
  });

  it("caso 8: legada revogada + única outra membership ACTIVE resolve a única (ONLY_ACTIVE_MEMBERSHIP)", async () => {
    const { company: legacyCompany, user } = await makeUserWithCompany("res-legacy-revoked");
    await createTestMembership({ userId: user.id, companyId: legacyCompany.id, status: "REVOKED" });

    const otherCompany = await createTestCompany("res-legacy-revoked-other");
    companyIds.push(otherCompany.id);
    await createTestMembership({ userId: user.id, companyId: otherCompany.id, status: "ACTIVE" });

    const result = await resolveCompanyContext({ userId: user.id, legacyCompanyId: legacyCompany.id });

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.companyId).toBe(otherCompany.id);
      expect(result.source).toBe("ONLY_ACTIVE_MEMBERSHIP");
    }
  });

  it("caso 9: sem legado, uma única membership ACTIVE resolve", async () => {
    const { company, user } = await makeUserWithCompany("res-nolegacy-one");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const result = await resolveCompanyContext({ userId: user.id });

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.companyId).toBe(company.id);
      expect(result.source).toBe("ONLY_ACTIVE_MEMBERSHIP");
    }
  });

  it("caso 10: sem legado, duas memberships ACTIVE exige seleção (nunca escolhe uma arbitrariamente)", async () => {
    const { company: companyA, user } = await makeUserWithCompany("res-nolegacy-twoA");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    const companyB = await createTestCompany("res-nolegacy-twoB");
    companyIds.push(companyB.id);
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });

    const result = await resolveCompanyContext({ userId: user.id });

    expect(result.status).toBe("SELECTION_REQUIRED");
    if (result.status === "SELECTION_REQUIRED") {
      expect(result.activeMembershipCount).toBe(2);
    }
  });

  it("caso 11: zero memberships ativas bloqueia", async () => {
    const { user } = await makeUserWithCompany("res-nolegacy-zero");

    const result = await resolveCompanyContext({ userId: user.id });

    expect(result.status).toBe("NO_ACTIVE_MEMBERSHIP");
  });
});

describe("resolveCompanyContext — disponibilidade da empresa", () => {
  // Exercitado via requestedCompanyId: é o único ramo do algoritmo que
  // retorna COMPANY_UNAVAILABLE de forma direta e determinística (ver
  // lib/company-context.ts) — o ramo sem requestedCompanyId simplesmente
  // filtra empresas indisponíveis do conjunto de candidatas.
  it("caso 12: Company.active = false bloqueia com reason INACTIVE_LEGACY_FLAG", async () => {
    const { company, user } = await makeUserWithCompany("res-avail-inactive");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    await prisma.company.update({ where: { id: company.id }, data: { active: false } });

    const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

    expect(result.status).toBe("COMPANY_UNAVAILABLE");
    if (result.status === "COMPANY_UNAVAILABLE") {
      expect(result.reason).toBe("INACTIVE_LEGACY_FLAG");
    }
  });

  it("caso 13: Company.operationalStatus = SUSPENDED bloqueia com reason SUSPENDED", async () => {
    const { company, user } = await makeUserWithCompany("res-avail-suspended");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    await prisma.company.update({ where: { id: company.id }, data: { operationalStatus: "SUSPENDED" } });

    const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

    expect(result.status).toBe("COMPANY_UNAVAILABLE");
    if (result.status === "COMPANY_UNAVAILABLE") {
      expect(result.reason).toBe("SUSPENDED");
    }
  });

  it("caso 14: Company.operationalStatus = CLOSED bloqueia com reason CLOSED", async () => {
    const { company, user } = await makeUserWithCompany("res-avail-closed");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    await prisma.company.update({ where: { id: company.id }, data: { operationalStatus: "CLOSED" } });

    const result = await resolveCompanyContext({ userId: user.id, requestedCompanyId: company.id });

    expect(result.status).toBe("COMPANY_UNAVAILABLE");
    if (result.status === "COMPANY_UNAVAILABLE") {
      expect(result.reason).toBe("CLOSED");
    }
  });
});
