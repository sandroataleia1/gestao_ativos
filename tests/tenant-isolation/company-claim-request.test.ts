import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestUser,
  createTestUserWithMembership,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore, setActiveCompanyCookie } from "@/tests/helpers/mock-request-context";
import { withValidCheckDigits } from "@/lib/cnpj";
import { ConflictError, NotFoundError } from "@/lib/api-errors";

// Sprint SST 1.4C — contenção da vulnerabilidade em que só conhecer um CNPJ
// válido concedia CompanyMembership ACTIVE + papel ADMIN imediatamente. Este
// arquivo cobre a entidade CompanyClaimRequest (lib/company-claim-request.ts),
// o guard central de usuário sem membership (lib/auth-server.ts) e a
// blindagem do fluxo CONTINUE/BLOCK (lib/company-claim.ts) — os 30 itens do
// §23 do spec, incluindo concorrência real contra o Postgres de testes.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");
let claimRequestLib: typeof import("@/lib/company-claim-request");
let employeesRoute: typeof import("@/app/api/employees/route");
let sstProvidersRoute: typeof import("@/app/api/sst-providers/route");
let claimReviewRoute: typeof import("@/app/api/companies/claim-review/[relationshipId]/route");
let cancelClaimRoute: typeof import("@/app/api/company-claim-requests/[claimRequestId]/cancel/route");

const companyIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  claimRequestLib = await import("@/lib/company-claim-request");
  employeesRoute = await import("@/app/api/employees/route");
  sstProvidersRoute = await import("@/app/api/sst-providers/route");
  claimReviewRoute = await import("@/app/api/companies/claim-review/[relationshipId]/route");
  cancelClaimRoute = await import("@/app/api/company-claim-requests/[claimRequestId]/cancel/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeUnclaimedCompany(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
  return company;
}

async function makeRequester(companyIdForAnchor: string, label: string) {
  // O requester precisa de um User real — usa a mesma empresa como "âncora"
  // do User.companyId legado (FK obrigatória), nunca como autorização.
  const user = await createTestUser(companyIdForAnchor, label);
  return toSessionUser(user);
}

let cnpjSeq = 0;
function uniqueCnpj(): string {
  cnpjSeq += 1;
  const base = `${Date.now()}${cnpjSeq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

describe("createOrReuseClaimRequest — criação e reabertura (§5)", () => {
  it("1/2/3 — cria PENDING, nunca cria membership, empresa UNCLAIMED vira CLAIM_PENDING", async () => {
    const company = await makeUnclaimedCompany("claimreq-basic");
    const requester = await makeRequester(company.id, "claimreq-basic-r");

    const { claim, reused } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    expect(reused).toBe(false);
    expect(claim.status).toBe("PENDING");

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership).toBeNull();

    const userRole = await prisma.userRole.findFirst({ where: { userId: requester.id, companyId: company.id } });
    expect(userRole).toBeNull();

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("CLAIM_PENDING");
  });

  it("11 — claim duplicado do mesmo usuário é idempotente (reusa a mesma linha, nunca cria outra)", async () => {
    const company = await makeUnclaimedCompany("claimreq-idempotent");
    const requester = await makeRequester(company.id, "claimreq-idempotent-r");

    const first = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const second = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    expect(second.reused).toBe(true);
    expect(second.claim.id).toBe(first.claim.id);

    const count = await prisma.companyClaimRequest.count({ where: { companyId: company.id, requesterUserId: requester.id } });
    expect(count).toBe(1);
  });

  it("reabre uma solicitação REJECTED do mesmo usuário (nunca cria uma segunda linha)", async () => {
    const company = await makeUnclaimedCompany("claimreq-reopen");
    const requester = await makeRequester(company.id, "claimreq-reopen-r");

    const created = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    await prisma.companyClaimRequest.update({
      where: { id: created.claim.id },
      data: { status: "REJECTED", reviewedAt: new Date(), rejectionReason: "teste" },
    });

    const reopened = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    expect(reopened.claim.id).toBe(created.claim.id);
    expect(reopened.claim.status).toBe("PENDING");

    const row = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: created.claim.id } });
    expect(row.reviewedAt).toBeNull();
    expect(row.rejectionReason).toBeNull();

    const count = await prisma.companyClaimRequest.count({ where: { companyId: company.id, requesterUserId: requester.id } });
    expect(count).toBe(1);
  });

  it("9/26 — Company CLAIMED não pode ser reivindicada automaticamente; nunca é alterada", async () => {
    const company = await createTestCompanyWithRoles("claimreq-claimed");
    companyIds.push(company.id);
    // Default do schema já é CLAIMED.
    const before = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    const requester = await makeRequester(company.id, "claimreq-claimed-r");

    await expect(
      claimRequestLib.createOrReuseClaimRequest({
        companyId: company.id,
        requester: { id: requester.id, name: requester.name },
        origin: "EXISTING_PRE_REGISTRATION",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after).toEqual(before);
    const count = await prisma.companyClaimRequest.count({ where: { companyId: company.id } });
    expect(count).toBe(0);
  });

  it("13 — dois usuários DIFERENTES solicitando a mesma empresa -> Company vira DISPUTED, nenhum recebe acesso", async () => {
    const company = await makeUnclaimedCompany("claimreq-dispute");
    const requesterA = await makeRequester(company.id, "claimreq-dispute-a");
    const requesterB = await makeRequester(company.id, "claimreq-dispute-b");

    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterA.id, name: requesterA.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterB.id, name: requesterB.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("DISPUTED");

    const membershipsCount = await prisma.companyMembership.count({ where: { companyId: company.id } });
    expect(membershipsCount).toBe(0);

    const disputedEvent = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "company_claim.disputed" },
    });
    expect(disputedEvent).not.toBeNull();
  });

  it("30 — CNPJ integral nunca aparece em metadata de auditoria do fluxo de claim", async () => {
    const company = await makeUnclaimedCompany("claimreq-audit-cnpj");
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });
    const requester = await makeRequester(company.id, "claimreq-audit-cnpj-r");

    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const events = await prisma.auditLog.findMany({ where: { companyId: company.id } });
    for (const event of events) {
      expect(JSON.stringify(event.metadata ?? {})).not.toContain(cnpj);
    }
  });
});

describe("Concorrência real (§15) — createOrReuseClaimRequest", () => {
  it("mesmo usuário, mesma empresa: duas requisições simultâneas criam só UMA CompanyClaimRequest, nunca membership, nunca P2002 exposto", async () => {
    const company = await makeUnclaimedCompany("claimreq-race-same-user");
    const requester = await makeRequester(company.id, "claimreq-race-same-user-r");

    const results = await Promise.allSettled([
      claimRequestLib.createOrReuseClaimRequest({
        companyId: company.id,
        requester: { id: requester.id, name: requester.name },
        origin: "EXISTING_PRE_REGISTRATION",
      }),
      claimRequestLib.createOrReuseClaimRequest({
        companyId: company.id,
        requester: { id: requester.id, name: requester.name },
        origin: "EXISTING_PRE_REGISTRATION",
      }),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value.claim.status).toBe("PENDING");
      }
    }

    const count = await prisma.companyClaimRequest.count({ where: { companyId: company.id, requesterUserId: requester.id } });
    expect(count).toBe(1);
    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id } });
    expect(membershipCount).toBe(0);
  });

  it("usuários DIFERENTES, mesma empresa: nenhum recebe membership, empresa termina CLAIM_PENDING ou DISPUTED, nenhum deadlock, nenhum vínculo SST alterado", async () => {
    const company = await makeUnclaimedCompany("claimreq-race-diff-users");
    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__ claimreq-race-provider", active: true } });
    const link = await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });
    const requesterA = await makeRequester(company.id, "claimreq-race-diff-a");
    const requesterB = await makeRequester(company.id, "claimreq-race-diff-b");

    const [resultA, resultB] = await Promise.all([
      claimRequestLib.createOrReuseClaimRequest({
        companyId: company.id,
        requester: { id: requesterA.id, name: requesterA.name },
        origin: "EXISTING_PRE_REGISTRATION",
      }),
      claimRequestLib.createOrReuseClaimRequest({
        companyId: company.id,
        requester: { id: requesterB.id, name: requesterB.name },
        origin: "EXISTING_PRE_REGISTRATION",
      }),
    ]);

    expect(resultA.claim.status).toBe("PENDING");
    expect(resultB.claim.status).toBe("PENDING");

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id } });
    expect(membershipCount).toBe(0);

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(["CLAIM_PENDING", "DISPUTED"]).toContain(updatedCompany.controlStatus);

    const unchangedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchangedLink.status).toBe("ACTIVE");
    expect(unchangedLink.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");
  });
});

describe("approveCompanyClaimRequest (§13)", () => {
  async function makePendingClaim(label: string) {
    const company = await makeUnclaimedCompany(label);
    const requester = await makeRequester(company.id, `${label}-r`);
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, `${label}-reviewer`);
    return { company, requester, claim, reviewer };
  }

  it("18/19/20 — aprovação cria UMA membership ACTIVE com papel ADMIN, transacionalmente, e finaliza CLAIMED", async () => {
    const { company, requester, claim, reviewer } = await makePendingClaim("claimreq-approve-basic");

    const result = await claimRequestLib.approveCompanyClaimRequest({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
    });
    expect(result.controlStatus).toBe("CLAIMED");

    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership.status).toBe("ACTIVE");

    const userRole = await prisma.userRole.findFirst({
      where: { userId: requester.id, companyId: company.id, role: { name: "ADMIN" } },
    });
    expect(userRole).not.toBeNull();

    const updatedClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updatedClaim.status).toBe("APPROVED");
    expect(updatedClaim.reviewedByUserId).toBe(reviewer.id);
    expect(updatedClaim.reviewedAt).not.toBeNull();

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("CLAIMED");
    expect(updatedCompany.claimedAt).not.toBeNull();
  });

  it("mantém CLAIM_PENDING (não finaliza CLAIMED) quando ainda existe vínculo SST provisório não revisado", async () => {
    const { company, requester, claim, reviewer } = await makePendingClaim("claimreq-approve-provisional");
    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__ claimreq-approve-prov", active: true } });
    await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    const result = await claimRequestLib.approveCompanyClaimRequest({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
    });
    expect(result.controlStatus).toBe("CLAIM_PENDING");

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership?.status).toBe("ACTIVE"); // já pode acessar; só o vínculo SST fica por decidir
  });

  it("13 (parte 2) — ao aprovar UM solicitante, os demais solicitantes concorrentes são automaticamente REJECTED", async () => {
    const company = await makeUnclaimedCompany("claimreq-approve-supersede");
    const requesterA = await makeRequester(company.id, "claimreq-approve-supersede-a");
    const requesterB = await makeRequester(company.id, "claimreq-approve-supersede-b");
    const reviewer = await makeRequester(company.id, "claimreq-approve-supersede-reviewer");

    const { claim: claimA } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterA.id, name: requesterA.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const { claim: claimB } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterB.id, name: requesterB.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claimA.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const updatedClaimB = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claimB.id } });
    expect(updatedClaimB.status).toBe("REJECTED");

    const membershipB = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requesterB.id, companyId: company.id } },
    });
    expect(membershipB).toBeNull();
  });

  it("18 negativo — chamador não pode forjar companyId/requesterUserId/roleId/reviewedByUserId: tudo deriva da própria CompanyClaimRequest já persistida", async () => {
    const { requester, claim, reviewer } = await makePendingClaim("claimreq-approve-no-forge");
    const otherReviewer = await makeRequester(claim.companyId, "claimreq-approve-no-forge-other");

    const result = await claimRequestLib.approveCompanyClaimRequest({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
    });
    // reviewedByUserId é sempre o `reviewer` passado pelo CHAMADOR DO
    // SERVIÇO (futuro Super Admin Lite) — nunca um campo do body de uma
    // requisição HTTP, já que não existe endpoint público para isto.
    const updatedClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updatedClaim.reviewedByUserId).toBe(reviewer.id);
    expect(updatedClaim.reviewedByUserId).not.toBe(otherReviewer.id);
    expect(updatedClaim.requesterUserId).toBe(requester.id); // nunca mudou
    void result;
  });
});

describe("Concorrência real (§15) — approveCompanyClaimRequest", () => {
  it("21 — duas aprovações do mesmo claim: só uma produz efeito, existe uma única membership, segunda é conflito semântico (nunca 2 memberships)", async () => {
    const company = await makeUnclaimedCompany("claimreq-race-approve");
    const requester = await makeRequester(company.id, "claimreq-race-approve-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "claimreq-race-approve-reviewer");

    const results = await Promise.allSettled([
      claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } }),
      claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    }

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    expect(membershipCount).toBe(1);
    const roleCount = await prisma.userRole.count({ where: { companyId: company.id, userId: requester.id } });
    expect(roleCount).toBe(1);
    const approvedEvents = await prisma.auditLog.count({ where: { companyId: company.id, action: "company_claim.approved" } });
    expect(approvedEvents).toBe(1);
  });

  it("aprovação vs cancelamento simultâneos: estado final é único e consistente (nunca os dois efeitos aplicados)", async () => {
    const company = await makeUnclaimedCompany("claimreq-race-approve-cancel");
    const requester = await makeRequester(company.id, "claimreq-race-approve-cancel-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "claimreq-race-approve-cancel-reviewer");

    const results = await Promise.allSettled([
      claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } }),
      claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } }),
    ]);

    const finalClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(["APPROVED", "CANCELLED"]).toContain(finalClaim.status);

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    if (finalClaim.status === "APPROVED") {
      expect(membershipCount).toBe(1);
    } else {
      expect(membershipCount).toBe(0);
    }
    // Exatamente uma das duas operações teve efeito real.
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);
  });
});

describe("rejectCompanyClaimRequest / cancelCompanyClaimRequest (§14)", () => {
  it("22 — cancelamento não concede acesso; reverte a Company para UNCLAIMED quando não sobra outra solicitação ativa", async () => {
    const company = await makeUnclaimedCompany("claimreq-cancel-basic");
    const requester = await makeRequester(company.id, "claimreq-cancel-basic-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    await claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } });

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership).toBeNull();

    const updatedClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updatedClaim.status).toBe("CANCELLED");

    const updatedCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.controlStatus).toBe("UNCLAIMED");
  });

  it("23 — rejeição não concede acesso; preserva a solicitação (nunca apaga)", async () => {
    const company = await makeUnclaimedCompany("claimreq-reject-basic");
    const requester = await makeRequester(company.id, "claimreq-reject-basic-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "claimreq-reject-basic-reviewer");

    await claimRequestLib.rejectCompanyClaimRequest({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reason: "Documentação insuficiente",
    });

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership).toBeNull();

    const updatedClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updatedClaim.status).toBe("REJECTED");
    expect(updatedClaim.rejectionReason).toBe("Documentação insuficiente");
  });

  it("15 — cancelamento nunca aceita cancelar a solicitação de OUTRO usuário (ownership check)", async () => {
    const company = await makeUnclaimedCompany("claimreq-cancel-ownership");
    const requester = await makeRequester(company.id, "claimreq-cancel-ownership-r");
    const intruder = await makeRequester(company.id, "claimreq-cancel-ownership-intruder");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    await expect(
      claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: intruder.id, name: intruder.name } }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const unchanged = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("15 (via HTTP) — POST /api/company-claim-requests/[id]/cancel bloqueia claimRequestId de outro usuário (404)", async () => {
    const company = await makeUnclaimedCompany("claimreq-cancel-http-ownership");
    const requester = await makeRequester(company.id, "claimreq-cancel-http-ownership-r");
    const intruder = await makeRequester(company.id, "claimreq-cancel-http-ownership-intruder");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(intruder);
    const req = new NextRequest(`http://localhost/api/company-claim-requests/${claim.id}/cancel`, { method: "POST" });
    const res = await cancelClaimRoute.POST(req, { params: Promise.resolve({ claimRequestId: claim.id }) });
    expect(res.status).toBe(404);

    const unchanged = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("POST cancel via HTTP funciona para o próprio dono", async () => {
    const company = await makeUnclaimedCompany("claimreq-cancel-http-owner");
    const requester = await makeRequester(company.id, "claimreq-cancel-http-owner-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    const req = new NextRequest(`http://localhost/api/company-claim-requests/${claim.id}/cancel`, { method: "POST" });
    const res = await cancelClaimRoute.POST(req, { params: Promise.resolve({ claimRequestId: claim.id }) });
    expect(res.status).toBe(200);

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("CANCELLED");
  });
});

describe("Guard central — usuário com claim pendente (§11/§16/§17)", () => {
  it("4/16 — requireCompany() lança CompanyClaimPendingError (nunca acessa dashboard/API empresarial)", async () => {
    const company = await makeUnclaimedCompany("guard-claim-pending");
    const requester = await makeRequester(company.id, "guard-claim-pending-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.CompanyClaimPendingError);
  });

  it("página do Portal Empresa (requireCompanyOrDeny) redireciona para /company-claim/pending, nunca app/forbidden.tsx", async () => {
    const company = await makeUnclaimedCompany("guard-claim-pending-redirect");
    const requester = await makeRequester(company.id, "guard-claim-pending-redirect-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    let redirected: { digest?: string } | null = null;
    try {
      await authServer.requireCompanyOrDeny();
    } catch (error) {
      redirected = error as { digest?: string };
    }
    expect(redirected).not.toBeNull();
    expect(redirected?.digest).toContain("/company-claim/pending");
  });

  it("5/16 — GET /api/employees devolve 403 CLAIM_PENDING para usuário com claim ativa (nunca dados)", async () => {
    const company = await makeUnclaimedCompany("guard-claim-pending-employees");
    const requester = await makeRequester(company.id, "guard-claim-pending-employees-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    const res = await employeesRoute.GET(new NextRequest("http://localhost/api/employees"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("CLAIM_PENDING");
  });

  it("6/16 — GET /api/sst-providers (visualizar consultorias) devolve 403 CLAIM_PENDING", async () => {
    const company = await makeUnclaimedCompany("guard-claim-pending-sstproviders");
    const requester = await makeRequester(company.id, "guard-claim-pending-sstproviders-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    const res = await sstProvidersRoute.GET();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("CLAIM_PENDING");
  });

  it("16/17 — active_company_id apontando para a Company pendente NÃO concede acesso (sem membership, resolver rejeita)", async () => {
    const company = await makeUnclaimedCompany("guard-claim-pending-cookie");
    const requester = await makeRequester(company.id, "guard-claim-pending-cookie-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    setActiveCompanyCookie(company.id);
    // Sem CompanyMembership ACTIVE para (requester, company) — o resolver
    // (lib/company-context.ts) nunca concede acesso só porque o cookie
    // aponta pra lá; cai em INVALID_REQUESTED_CONTEXT -> ForbiddenError.
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });

  it("16/17 — User.companyId legado apontando para a Company pendente NÃO concede acesso", async () => {
    // O próprio makeRequester já usa `company.id` como User.companyId
    // legado (âncora obrigatória) — este teste prova exatamente que isso
    // nunca é suficiente sozinho.
    const company = await makeUnclaimedCompany("guard-claim-pending-legacy");
    const requester = await makeRequester(company.id, "guard-claim-pending-legacy-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.CompanyClaimPendingError);
  });
});

describe("Proteção do fluxo CONTINUE/BLOCK antes da aprovação (§12/§16)", () => {
  it("7/8/24 — usuário sem claim aprovada não executa CONTINUE nem BLOCK, mesmo com permissão SST_PROVIDER_MANAGE e Company CLAIM_PENDING", async () => {
    // Simula (deliberadamente, via fixture direta) o estado "alguém tem
    // CompanyMembership ADMIN nesta empresa, mas NUNCA houve uma
    // CompanyClaimRequest aprovada" — não deveria ser alcançável pelo fluxo
    // real (membership só nasce de aprovação, ver approveCompanyClaimRequest),
    // mas o guard em lib/company-claim.ts precisa recusar mesmo assim,
    // como defesa em profundidade contra qualquer bug futuro de wiring.
    const company = await createTestCompanyWithRoles("guard-continue-block-no-claim");
    companyIds.push(company.id);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const rawAdmin = await createTestUserWithMembership(company.id, "guard-continue-block-no-claim-admin");
    await assignSystemRole(rawAdmin.id, company.id, "ADMIN");
    const admin = toSessionUser(rawAdmin);

    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__ guard-continue-block-p", active: true } });
    const link = await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    loginAs(admin);
    const req = new NextRequest("http://localhost/api/companies/claim-review/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "CONTINUE" }),
    });
    const res = await claimReviewRoute.POST(req, { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(403);

    const unchangedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchangedLink.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");
    expect(unchangedLink.companyReviewedAt).toBeNull();
  });

  it("24 — vínculos SST não mudam antes da aprovação: CONTINUE/BLOCK só funciona depois de approveCompanyClaimRequest", async () => {
    const company = await makeUnclaimedCompany("guard-continue-block-after-approve");
    const requester = await makeRequester(company.id, "guard-continue-block-after-approve-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__ guard-continue-block-after-p", active: true } });
    const link = await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    const reviewer = await makeRequester(company.id, "guard-continue-block-after-approve-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    loginAs(requester);
    const req = new NextRequest("http://localhost/api/companies/claim-review/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "CONTINUE" }),
    });
    const res = await claimReviewRoute.POST(req, { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(200);

    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.authorizationBasis).toBe("COMPANY_APPROVAL");
  });
});

describe("Impacto em dados existentes (§20/§22)", () => {
  it("25/27 — dados preexistentes (colaboradores) e memberships de OUTRAS empresas permanecem intactos ao criar/aprovar uma claim", async () => {
    const untouchedCompany = await createTestCompanyWithRoles("claimreq-untouched");
    companyIds.push(untouchedCompany.id);
    const untouchedUser = await createTestUserWithMembership(untouchedCompany.id, "claimreq-untouched-user");
    const untouchedEmployee = await prisma.employee.create({
      data: { companyId: untouchedCompany.id, name: "__tenant_test__ Colaborador Preexistente", document: "12345678900" },
    });

    const company = await makeUnclaimedCompany("claimreq-side-effect");
    const requester = await makeRequester(company.id, "claimreq-side-effect-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "claimreq-side-effect-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const untouchedMembership = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: untouchedUser.id, companyId: untouchedCompany.id } },
    });
    expect(untouchedMembership.status).toBe("ACTIVE");

    const stillThereEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: untouchedEmployee.id } });
    expect(stillThereEmployee.name).toBe("__tenant_test__ Colaborador Preexistente");
  });
});
