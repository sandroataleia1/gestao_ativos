import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestProvider,
  createTestUserWithMembership,
  linkProviderToCompany,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies } from "@/tests/helpers/mock-request-context";

// Sprint Comercial SST 1.4, §14/§15 — Portal Empresa aprova (com escolha de
// nível de acesso) ou recusa (REJECTED) uma solicitação PENDING; REVOKED e
// REJECTED são estados terminais (nunca aceitam PATCH depois). Mesmo padrão
// de tests/tenant-isolation/sst-provider-search-link.test.ts.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let linkRoute: typeof import("@/app/api/sst-providers/[id]/route");
let approveRoute: typeof import("@/app/api/sst-providers/requests/[relationshipId]/approve/route");
let rejectRoute: typeof import("@/app/api/sst-providers/requests/[relationshipId]/reject/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

let companyA: { id: string };
let companyB: { id: string };
let adminA: TestSessionUser;
let consultaA: TestSessionUser;

beforeAll(async () => {
  linkRoute = await import("@/app/api/sst-providers/[id]/route");
  approveRoute = await import("@/app/api/sst-providers/requests/[relationshipId]/approve/route");
  rejectRoute = await import("@/app/api/sst-providers/requests/[relationshipId]/reject/route");

  companyA = await createTestCompanyWithRoles("provapprove-a");
  companyB = await createTestCompanyWithRoles("provapprove-b");
  companyIds.push(companyA.id, companyB.id);

  const rawAdminA = await createTestUserWithMembership(companyA.id, "provapprove-admin-a");
  await assignSystemRole(rawAdminA.id, companyA.id, "ADMIN");
  adminA = toSessionUser(rawAdminA);

  const rawConsultaA = await createTestUserWithMembership(companyA.id, "provapprove-consulta-a");
  await assignSystemRole(rawConsultaA.id, companyA.id, "CONSULTA");
  consultaA = toSessionUser(rawConsultaA);
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

function patchRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/sst-providers/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makePendingLink(companyId: string, label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  const link = await linkProviderToCompany({ providerId: provider.id, companyId, status: "PENDING", accessLevel: "VIEW" });
  return { provider, link };
}

describe("PATCH /api/sst-providers/[id] — aprovar com nível de acesso escolhido (§14)", () => {
  it("aprova um PENDING com o nível de acesso escolhido pela empresa (não herda o pedido)", async () => {
    const { link } = await makePendingLink(companyA.id, "approve-level");
    loginAs(adminA);

    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "ACTIVE", accessLevel: "ADMINISTRATION" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerLink: { status: string; accessLevel: string } };
    expect(body.providerLink.status).toBe("ACTIVE");
    expect(body.providerLink.accessLevel).toBe("ADMINISTRATION"); // != VIEW pedido originalmente
  });

  it("aprova sem accessLevel -> mantém o nível já registrado (regressão do fluxo antigo)", async () => {
    const { link } = await makePendingLink(companyA.id, "approve-keep");
    loginAs(adminA);

    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "ACTIVE" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerLink: { accessLevel: string } };
    expect(body.providerLink.accessLevel).toBe("VIEW");
  });
});

describe("PATCH /api/sst-providers/[id] — recusar (REJECTED, §14/§15)", () => {
  it("recusa um PENDING -> status REJECTED, nunca concede acesso", async () => {
    const { link, provider } = await makePendingLink(companyA.id, "reject-basic");
    loginAs(adminA);

    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "REJECTED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerLink: { status: string } };
    expect(body.providerLink.status).toBe("REJECTED");

    const audit = await prisma.auditLog.findFirst({
      where: { companyId: companyA.id, action: "sst_provider.reject", targetId: link.id },
    });
    expect(audit).not.toBeNull();
    void provider;
  });

  for (const terminalStatus of ["REVOKED", "REJECTED"] as const) {
    it(`vínculo ${terminalStatus} é terminal — nenhum PATCH depois (400)`, async () => {
      const provider = await createTestProvider(`approve-terminal-${terminalStatus.toLowerCase()}`);
      providerIds.push(provider.id);
      const link = await linkProviderToCompany({ providerId: provider.id, companyId: companyA.id, status: terminalStatus });

      loginAs(adminA);
      const res = await linkRoute.PATCH(patchRequest(link.id, { status: "ACTIVE" }), {
        params: Promise.resolve({ id: link.id }),
      });
      expect(res.status).toBe(400);

      const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
      expect(unchanged.status).toBe(terminalStatus);
    });
  }

  it("usuário sem sst_provider:manage (CONSULTA) não consegue aprovar nem recusar", async () => {
    const { link: linkForApprove } = await makePendingLink(companyA.id, "reject-forbidden-approve");
    const { link: linkForReject } = await makePendingLink(companyA.id, "reject-forbidden-reject");
    loginAs(consultaA);

    const resApprove = await linkRoute.PATCH(patchRequest(linkForApprove.id, { status: "ACTIVE" }), {
      params: Promise.resolve({ id: linkForApprove.id }),
    });
    expect(resApprove.status).toBe(403);

    const resReject = await linkRoute.PATCH(patchRequest(linkForReject.id, { status: "REJECTED" }), {
      params: Promise.resolve({ id: linkForReject.id }),
    });
    expect(resReject.status).toBe(403);
  });

  it("empresa A não consegue agir sobre um vínculo da empresa B (404 — ownership check)", async () => {
    const { link } = await makePendingLink(companyB.id, "reject-cross-company");
    loginAs(adminA);

    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "REJECTED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(404);

    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged.status).toBe("PENDING");
  });
});

describe("POST /api/sst-providers/requests/[relationshipId]/{approve,reject} — contrato dedicado (§15)", () => {
  function requestUrl(relationshipId: string, action: "approve" | "reject") {
    return new NextRequest(`http://localhost/api/sst-providers/requests/${relationshipId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  it("aprova via endpoint dedicado -> ACTIVE, authorizationBasis COMPANY_APPROVAL, companyReviewedAt/By preenchidos", async () => {
    const { link } = await makePendingLink(companyA.id, "dedicated-approve");
    loginAs(adminA);

    const res = await approveRoute.POST(requestUrl(link.id, "approve"), { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerLink: { status: string } };
    expect(body.providerLink.status).toBe("ACTIVE");

    const updated = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.authorizationBasis).toBe("COMPANY_APPROVAL");
    expect(updated.companyReviewedAt).not.toBeNull();
    expect(updated.companyReviewedByUserId).toBe(adminA.id);
  });

  it("aprova via endpoint dedicado com accessLevel escolhido", async () => {
    const { link } = await makePendingLink(companyA.id, "dedicated-approve-level");
    loginAs(adminA);

    const req = new NextRequest(`http://localhost/api/sst-providers/requests/${link.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessLevel: "ADMINISTRATION" }),
    });
    const res = await approveRoute.POST(req, { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.accessLevel).toBe("ADMINISTRATION");
  });

  it("recusa via endpoint dedicado -> REJECTED, companyReviewedAt/By preenchidos", async () => {
    const { link } = await makePendingLink(companyA.id, "dedicated-reject");
    loginAs(adminA);

    const res = await rejectRoute.POST(requestUrl(link.id, "reject"), { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerLink: { status: string } };
    expect(body.providerLink.status).toBe("REJECTED");

    const updated = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.companyReviewedAt).not.toBeNull();
    expect(updated.companyReviewedByUserId).toBe(adminA.id);
  });

  it("endpoints dedicados também respeitam ownership (404 para vínculo de outra empresa)", async () => {
    const { link } = await makePendingLink(companyB.id, "dedicated-cross");
    loginAs(adminA);

    const res = await approveRoute.POST(requestUrl(link.id, "approve"), { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(404);
  });

  it("endpoints dedicados exigem sst_provider:manage (403 para CONSULTA)", async () => {
    const { link } = await makePendingLink(companyA.id, "dedicated-forbidden");
    loginAs(consultaA);

    const res = await rejectRoute.POST(requestUrl(link.id, "reject"), { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(403);
  });
});
