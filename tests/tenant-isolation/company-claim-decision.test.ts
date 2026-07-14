import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestProvider,
  createTestUserWithMembership,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";

// Sprint Comercial SST 1.4 (extensão) — decisão da empresa sobre um vínculo
// provisório criado pelo pré-cadastro de uma consultoria (§16-§19):
// POST /api/companies/claim-review/[relationshipId]. Mesmo padrão de mock
// de sessão de tests/tenant-isolation/sst-provider-search-link.test.ts.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let claimRoute: typeof import("@/app/api/companies/claim-review/[relationshipId]/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

function decisionRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/companies/claim-review/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeClaimPendingCompany(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });

  const rawAdmin = await createTestUserWithMembership(company.id, `${label}-admin`);
  await assignSystemRole(rawAdmin.id, company.id, "ADMIN");
  const admin = toSessionUser(rawAdmin);

  const provider = await createTestProvider(label);
  providerIds.push(provider.id);

  const link = await prisma.sstProviderCompany.create({
    data: {
      providerId: provider.id,
      companyId: company.id,
      status: "ACTIVE",
      accessLevel: "ADMINISTRATION",
      authorizationBasis: "PROVIDER_PRE_REGISTRATION",
    },
  });

  return { company, admin, provider, link };
}

describe("POST /api/companies/claim-review/[relationshipId] — decisão de reivindicação (§17/§18)", () => {
  it("CONTINUE: vínculo vira COMPANY_APPROVAL, empresa finaliza CLAIMED (único vínculo pendente)", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin, provider, link } = await makeClaimPendingCompany("claim-continue");
    loginAs(admin);

    const res = await claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimFinalized: boolean; link: { status: string } };
    expect(body.claimFinalized).toBe(true);
    expect(body.link.status).toBe("ACTIVE");

    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.authorizationBasis).toBe("COMPANY_APPROVAL");
    expect(updatedLink.companyReviewedAt).not.toBeNull();
    expect(updatedLink.companyReviewedByUserId).toBe(admin.id);

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("CLAIMED");
    expect(updatedCompany.claimedAt).not.toBeNull();
    void provider;
  });

  it("CONTINUE com accessLevel escolhido -> respeita o nível informado", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { admin, link } = await makeClaimPendingCompany("claim-level");
    loginAs(admin);

    const res = await claimRoute.POST(decisionRequest({ decision: "CONTINUE", accessLevel: "VIEW" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res.status).toBe(200);
    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.accessLevel).toBe("VIEW");
  });

  it("BLOCK: vínculo vira REVOKED, dados da empresa nunca são apagados, empresa finaliza CLAIMED", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin, link } = await makeClaimPendingCompany("claim-block");
    loginAs(admin);

    const res = await claimRoute.POST(decisionRequest({ decision: "BLOCK" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimFinalized: boolean; link: { status: string } };
    expect(body.claimFinalized).toBe(true);
    expect(body.link.status).toBe("REVOKED");

    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("REVOKED");
    expect(updatedLink.revokedAt).not.toBeNull();
    expect(updatedLink.companyReviewedByUserId).toBe(admin.id);
    // authorizationBasis é só histórico — não precisa mudar ao bloquear.
    expect(updatedLink.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("CLAIMED");

    // A empresa em si (Company) continua intacta — nunca apagada.
    const stillThere = await prisma.company.findUnique({ where: { id: company.id } });
    expect(stillThere).not.toBeNull();
  });

  it("duas consultorias provisórias -> só finaliza CLAIMED quando as duas forem decididas", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin, link: link1 } = await makeClaimPendingCompany("claim-multi");

    const provider2 = await createTestProvider("claim-multi-2");
    providerIds.push(provider2.id);
    const link2 = await prisma.sstProviderCompany.create({
      data: {
        providerId: provider2.id,
        companyId: company.id,
        status: "ACTIVE",
        accessLevel: "ADMINISTRATION",
        authorizationBasis: "PROVIDER_PRE_REGISTRATION",
      },
    });

    loginAs(admin);
    const res1 = await claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), {
      params: Promise.resolve({ relationshipId: link1.id }),
    });
    const body1 = (await res1.json()) as { claimFinalized: boolean };
    expect(body1.claimFinalized).toBe(false);

    let stillPending = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stillPending.controlStatus).toBe("CLAIM_PENDING");

    const res2 = await claimRoute.POST(decisionRequest({ decision: "BLOCK" }), {
      params: Promise.resolve({ relationshipId: link2.id }),
    });
    const body2 = (await res2.json()) as { claimFinalized: boolean };
    expect(body2.claimFinalized).toBe(true);

    stillPending = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(stillPending.controlStatus).toBe("CLAIMED");
  });

  it("nunca decide sobre o vínculo de outra empresa (ownership check, 404)", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { link: linkA } = await makeClaimPendingCompany("claim-cross-a");
    const { admin: adminB } = await makeClaimPendingCompany("claim-cross-b");

    loginAs(adminB);
    const res = await claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), {
      params: Promise.resolve({ relationshipId: linkA.id }),
    });
    expect(res.status).toBe(404);

    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: linkA.id } });
    expect(unchanged.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");
    expect(unchanged.companyReviewedAt).toBeNull();
  });

  it("decidir duas vezes sobre o mesmo vínculo falha na segunda vez (404) — nunca reaplica a ação", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { admin, link } = await makeClaimPendingCompany("claim-twice");
    loginAs(admin);

    const res1 = await claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res1.status).toBe(200);

    const res2 = await claimRoute.POST(decisionRequest({ decision: "BLOCK" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res2.status).toBe(404);

    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged.status).toBe("ACTIVE"); // continua CONTINUE, não virou BLOCK
  });

  it("usuário sem sst_provider:manage é bloqueado (403)", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, link } = await makeClaimPendingCompany("claim-forbidden");
    const rawConsulta = await createTestUserWithMembership(company.id, "claim-forbidden-consulta");
    await assignSystemRole(rawConsulta.id, company.id, "CONSULTA");
    loginAs(toSessionUser(rawConsulta));

    const res = await claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), {
      params: Promise.resolve({ relationshipId: link.id }),
    });
    expect(res.status).toBe(403);
  });
});
