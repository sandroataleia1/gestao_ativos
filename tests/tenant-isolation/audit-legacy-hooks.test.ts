import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestMembership,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore, setActiveCompanyCookie } from "@/tests/helpers/mock-request-context";
import { resolveUnambiguousCompany } from "@/lib/company-context";
import type { QrLookup } from "@/lib/qr-code";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let qrCode: typeof import("@/lib/qr-code");

const companyIds: string[] = [];

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

function assetLookup(companyId: string): QrLookup {
  return {
    type: "ASSET",
    companyId,
    companyName: "irrelevante",
    companyLogoDataUrl: null,
    status: "irrelevante",
    resource: {
      id: "irrelevante",
      name: "irrelevante",
      assetCode: "irrelevante",
      categoryName: "irrelevante",
      statusName: "irrelevante",
      conditionName: "irrelevante",
      trackingMode: "INDIVIDUAL",
      active: true,
    },
  };
}

describe("Sprint 0.6, Parte A.1 — resolveUnambiguousCompany (base dos hooks de auditoria)", () => {
  it("caso 1: usuário com exatamente uma membership ativa resolve — auditoria pode usar essa empresa", async () => {
    const company = await createTestCompany("audit-single");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "audit-single");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const result = await resolveUnambiguousCompany(user.id);

    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") {
      expect(result.companyId).toBe(company.id);
    }
  });

  it("caso 2: usuário com duas memberships ativas NÃO resolve — nunca escolhe a legada arbitrariamente", async () => {
    const companyA = await createTestCompany("audit-two-A");
    const companyB = await createTestCompany("audit-two-B");
    companyIds.push(companyA.id, companyB.id);
    // user.companyId (legado) = companyA — mas isso NUNCA deve influenciar
    // resolveUnambiguousCompany, diferente de resolveCompanyContext.
    const user = await createTestUser(companyA.id, "audit-two");
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    await createTestMembership({ userId: user.id, companyId: companyB.id, status: "ACTIVE" });

    const result = await resolveUnambiguousCompany(user.id);

    expect(result.status).toBe("AMBIGUOUS");
    if (result.status === "AMBIGUOUS") {
      expect(result.activeMembershipCount).toBe(2);
    }
  });

  it("zero memberships ativas também não resolve (NONE, não erro)", async () => {
    const company = await createTestCompany("audit-zero");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "audit-zero");

    const result = await resolveUnambiguousCompany(user.id);

    expect(result.status).toBe("NONE");
  });
});

describe("Sprint 0.6, Parte A.2 — sameCompany do QR usa o contexto resolvido", () => {
  it("caso 3: sameCompany reflete o companyId RESOLVIDO, não User.companyId bruto", async () => {
    qrCode = await import("@/lib/qr-code");

    const legacyCompany = await createTestCompany("qr-legacy");
    const activeCompany = await createTestCompany("qr-active");
    companyIds.push(legacyCompany.id, activeCompany.id);

    // User.companyId (legado) aponta pra legacyCompany, mas a ÚNICA
    // membership ativa é em activeCompany (a legada está REVOKED) — o
    // contexto resolvido (via ONLY_ACTIVE_MEMBERSHIP) é activeCompany.
    const user = await createTestUser(legacyCompany.id, "qr-user");
    await createTestMembership({ userId: user.id, companyId: legacyCompany.id, status: "REVOKED" });
    await createTestMembership({ userId: user.id, companyId: activeCompany.id, status: "ACTIVE" });

    loginAs(toSessionUser(user));

    // QR de um recurso da empresa ATIVA (contexto resolvido) — sameCompany true.
    const permissionsForActive = await qrCode.computeQrPermissions(assetLookup(activeCompany.id));
    expect(permissionsForActive.sameCompany).toBe(true);

    // QR de um recurso da empresa LEGADA (User.companyId bruto) — sameCompany
    // false, provando que não é mais essa a fonte usada.
    const permissionsForLegacy = await qrCode.computeQrPermissions(assetLookup(legacyCompany.id));
    expect(permissionsForLegacy.sameCompany).toBe(false);
  });
});
