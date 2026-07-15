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
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { resolveRegisterSuccessOutcome } from "@/lib/register-response";
import { validateSinceTimestamp } from "@/lib/claim-exposure-timestamp";
import { isPrematureAssociation } from "@/lib/premature-association";
import { ForbiddenError } from "@/lib/auth-server";

// Sprint SST 1.4C.1 — fechamento do fluxo de reivindicação: cliente do
// cadastro (CLAIM_REVIEW_REQUIRED nunca mais cai em /dashboard),
// User.companyId nullable (nunca preenchido antes da aprovação),
// approveCompanyClaimRequest preenche a preferência só depois da
// membership, estados terminais da página de acompanhamento, e os dois
// diagnósticos novos.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");
let claimRequestLib: typeof import("@/lib/company-claim-request");
let claimReviewRoute: typeof import("@/app/api/companies/claim-review/[relationshipId]/route");
let onboardingSstProvidersPage: typeof import("@/app/onboarding/sst-providers/page");

const companyIds: string[] = [];
// Sprint SST 1.4C.1 — usuários criados por makeRequester() têm companyId
// null (nunca uma âncora), então nunca são alcançados pelo filtro
// `companyId: { in: companyIds }` de cleanupFixtures — precisam de
// rastreamento e limpeza próprios.
const requesterUserIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
  claimRequestLib = await import("@/lib/company-claim-request");
  claimReviewRoute = await import("@/app/api/companies/claim-review/[relationshipId]/route");
  onboardingSstProvidersPage = await import("@/app/onboarding/sst-providers/page");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  if (requesterUserIds.length > 0) {
    await prisma.companyClaimRequest.deleteMany({ where: { requesterUserId: { in: requesterUserIds } } });
    await prisma.companyMembership.deleteMany({ where: { userId: { in: requesterUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: requesterUserIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: requesterUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: requesterUserIds } } });
  }
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeUnclaimedCompany(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
  return company;
}

/** Sprint SST 1.4C.1 — um requerente recém-registrado tem `companyId: null`
 * de verdade (nunca mais uma âncora), diferente do padrão geral de
 * `createTestUser` (usado por outros arquivos de teste que precisam de um
 * companyId legado preenchido para outros fins). Cria o User diretamente
 * com `companyId: null` para simular com precisão o estado real pós-
 * registro desta sprint. `anchorCompanyId` continua existindo só para
 * ancorar a limpeza de fixtures (nunca vinculado ao User em si). */
async function makeRequester(anchorCompanyId: string, label: string) {
  void anchorCompanyId;
  const user = await prisma.user.create({
    data: {
      name: `__tenant_test__${label}`,
      email: `__tenant_test__${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      active: true,
    },
  });
  requesterUserIds.push(user.id);
  return toSessionUser(user);
}

describe("Cliente de registro — resolveRegisterSuccessOutcome (§2, itens 1/2)", () => {
  it("1 — CLAIM_REVIEW_REQUIRED redireciona para /company-claim/pending", () => {
    const outcome = resolveRegisterSuccessOutcome({ ok: true, status: "CLAIM_REVIEW_REQUIRED" });
    expect(outcome.redirectTo).toBe("/company-claim/pending");
    expect(outcome.message).not.toMatch(/erro/i);
  });

  it("2 — nunca redireciona para /dashboard, mesmo com status desconhecido/ausente", () => {
    expect(resolveRegisterSuccessOutcome(null).redirectTo).not.toBe("/dashboard");
    expect(resolveRegisterSuccessOutcome({}).redirectTo).not.toBe("/dashboard");
    expect(resolveRegisterSuccessOutcome({ status: "ALGO_FUTURO_DESCONHECIDO" }).redirectTo).not.toBe("/dashboard");
    // Nunca "para o mesmo lugar que um usuário sem acesso nenhum veria" —
    // sempre a página de acompanhamento, o destino mais seguro possível.
    expect(resolveRegisterSuccessOutcome({ status: "ALGO_FUTURO_DESCONHECIDO" }).redirectTo).toBe("/company-claim/pending");
  });
});

describe("User.companyId — nunca preenchido antes da aprovação (§4/§5, itens 9-12)", () => {
  it("9 — approveCompanyClaimRequest preenche User.companyId só depois de criar a membership", async () => {
    const company = await makeUnclaimedCompany("companyid-approve-fills");
    const requester = await makeRequester(company.id, "companyid-approve-fills-r");
    expect(requester.companyId).toBeNull();

    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const beforeApproval = await prisma.user.findUniqueOrThrow({ where: { id: requester.id } });
    expect(beforeApproval.companyId).toBeNull();

    const reviewer = await makeRequester(company.id, "companyid-approve-fills-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const afterApproval = await prisma.user.findUniqueOrThrow({ where: { id: requester.id } });
    expect(afterApproval.companyId).toBe(company.id);

    const membership = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership.status).toBe("ACTIVE");
  });

  it("10/12 — User.companyId isolado (sem membership) nunca concede acesso; aprovação não vira autorização", async () => {
    const company = await createTestCompanyWithRoles("companyid-isolated");
    companyIds.push(company.id);
    const rawUser = await createTestUser(company.id, "companyid-isolated-u");
    // Simula exatamente a associação prematura que este sprint corrige:
    // companyId preenchido, mas NENHUMA CompanyMembership real.
    loginAs(toSessionUser(rawUser));

    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(authServer.ForbiddenError);
  });

  it("11 — usuário multiempresa não perde a preferência/membership anterior ao aprovar uma SEGUNDA claim", async () => {
    const companyA = await createTestCompanyWithRoles("companyid-multi-a");
    companyIds.push(companyA.id);
    const rawUser = await createTestUserWithMembership(companyA.id, "companyid-multi-u");
    await assignSystemRole(rawUser.id, companyA.id, "ADMIN");
    // rawUser.companyId já é companyA (preenchido no momento da criação da
    // fixture) — preferência legítima e pré-existente.
    expect(rawUser.companyId).toBe(companyA.id);

    const companyB = await makeUnclaimedCompany("companyid-multi-b");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: companyB.id,
      requester: { id: rawUser.id, name: rawUser.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(companyB.id, "companyid-multi-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    // Preferência legada NUNCA foi sobrescrita silenciosamente.
    const afterApproval = await prisma.user.findUniqueOrThrow({ where: { id: rawUser.id } });
    expect(afterApproval.companyId).toBe(companyA.id);

    // A membership antiga (companyA) continua intacta.
    const membershipA = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: rawUser.id, companyId: companyA.id } },
    });
    expect(membershipA.status).toBe("ACTIVE");

    // A membership NOVA (companyB) também existe — multiempresa funcional.
    const membershipB = await prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId: rawUser.id, companyId: companyB.id } },
    });
    expect(membershipB.status).toBe("ACTIVE");
  });
});

describe("Redirects e guards (§7/§8, itens 13-17)", () => {
  it("14/17 — acesso direto a rota empresarial é bloqueado sem loop (CompanyClaimPendingError distinguível)", async () => {
    const company = await makeUnclaimedCompany("guard-direct-dashboard");
    const requester = await makeRequester(company.id, "guard-direct-dashboard-r");
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
    expect(redirected?.digest).toContain("/company-claim/pending");
    expect(redirected?.digest).not.toContain("/dashboard");
  });

  it("15 — acesso direto a /onboarding/sst-providers é bloqueado para usuário com claim pendente (sem membership)", async () => {
    const company = await makeUnclaimedCompany("guard-direct-onboarding");
    const requester = await makeRequester(company.id, "guard-direct-onboarding-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    loginAs(requester);
    let redirected: { digest?: string } | null = null;
    try {
      await onboardingSstProvidersPage.default();
    } catch (error) {
      redirected = error as { digest?: string };
    }
    // requirePermissionOrDeny(SST_PROVIDER_MANAGE) dentro da página lança
    // CompanyClaimPendingError (sem membership nenhuma) -> redirect para a
    // página de acompanhamento, nunca renderiza o painel de decisão.
    expect(redirected?.digest).toContain("/company-claim/pending");
  });
});

describe("Estados terminais do claim (§9, itens 20-25)", () => {
  it("20 — DISPUTED nunca revela o outro solicitante", async () => {
    const company = await makeUnclaimedCompany("state-disputed-company");
    const requesterA = await makeRequester(company.id, "state-disputed-reqAAA");
    const requesterB = await makeRequester(company.id, "state-disputed-reqBBB");

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

    const claimForPage = await claimRequestLib.getMostRecentClaimForPage(requesterA.id);
    expect(claimForPage?.company.controlStatus).toBe("DISPUTED");
    // A forma retornada para a página nunca inclui nada sobre o outro
    // solicitante (nem id, nem nome, nem e-mail) — só a própria claim e a
    // empresa.
    expect(JSON.stringify(claimForPage)).not.toContain(requesterB.id);
    expect(JSON.stringify(claimForPage)).not.toContain(requesterB.name);
  });

  it("21 — REJECTED não concede acesso", async () => {
    const company = await makeUnclaimedCompany("state-rejected");
    const requester = await makeRequester(company.id, "state-rejected-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "state-rejected-reviewer");
    await claimRequestLib.rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    loginAs(requester);
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(ForbiddenError);

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: requester.id, companyId: company.id } },
    });
    expect(membership).toBeNull();
  });

  it("22 — CANCELLED não concede acesso", async () => {
    const company = await makeUnclaimedCompany("state-cancelled");
    const requester = await makeRequester(company.id, "state-cancelled-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    await claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } });

    loginAs(requester);
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("23 — EXPIRED não concede acesso", async () => {
    const company = await makeUnclaimedCompany("state-expired");
    const requester = await makeRequester(company.id, "state-expired-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    // EXPIRED não tem nenhum job automático nesta sprint — simula o estado
    // final diretamente, como uma futura rotina de expiração faria.
    await prisma.companyClaimRequest.update({ where: { id: claim.id }, data: { status: "EXPIRED" } });

    loginAs(requester);
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(ForbiddenError);

    const claimForPage = await claimRequestLib.getMostRecentClaimForPage(requester.id);
    expect(claimForPage?.status).toBe("EXPIRED");
    expect(claimForPage?.hasActiveMembership).toBe(false);
  });

  it("24 — APPROVED sem membership real não concede acesso (defesa contra inconsistência)", async () => {
    const company = await makeUnclaimedCompany("state-approved-no-membership");
    const requester = await makeRequester(company.id, "state-approved-no-membership-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    // Estado inconsistente forçado diretamente (nunca alcançável pelo
    // serviço real, que sempre cria a membership ANTES de marcar APPROVED)
    // — prova que a página/guard nunca confiam só no status da claim.
    await prisma.companyClaimRequest.update({ where: { id: claim.id }, data: { status: "APPROVED", reviewedAt: new Date() } });

    const claimForPage = await claimRequestLib.getMostRecentClaimForPage(requester.id);
    expect(claimForPage?.status).toBe("APPROVED");
    expect(claimForPage?.hasActiveMembership).toBe(false);

    loginAs(requester);
    // Sem membership real, requireCompany() continua bloqueando — mas
    // agora cai no ForbiddenError genérico (não tem mais claim
    // PENDING/UNDER_REVIEW ativa para desviar para a página de
    // acompanhamento) — comportamento seguro de qualquer forma: nunca
    // acesso.
    await expect(authServer.requireCompany()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("25 — APPROVED com membership real permite acesso normal", async () => {
    const company = await makeUnclaimedCompany("state-approved-with-membership");
    const requester = await makeRequester(company.id, "state-approved-with-membership-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "state-approved-with-membership-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const claimForPage = await claimRequestLib.getMostRecentClaimForPage(requester.id);
    expect(claimForPage?.status).toBe("APPROVED");
    expect(claimForPage?.hasActiveMembership).toBe(true);

    loginAs(requester);
    const ctx = await authServer.requireCompany();
    expect(ctx.companyId).toBe(company.id);
  });
});

describe("Diagnóstico de exposição — timestamp obrigatório (§10, itens 26/27)", () => {
  it("26 — timestamp ausente é rejeitado (simulado via validateSinceTimestamp com string vazia não se aplica; testa formatos inválidos)", () => {
    const result = validateSinceTimestamp("");
    expect(result.ok).toBe(false);
  });

  it("27 — timestamp sem timezone explícita é rejeitado", () => {
    const result = validateSinceTimestamp("2026-07-14T20:34:08");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timezone/i);
  });

  it("27 — timestamp no futuro é rejeitado", () => {
    const now = new Date("2026-07-15T00:00:00Z");
    const result = validateSinceTimestamp("2099-01-01T00:00:00Z", now);
    expect(result.ok).toBe(false);
  });

  it("27 — ano implausivelmente antigo é rejeitado", () => {
    const result = validateSinceTimestamp("2016-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
  });

  it("timestamp válido (Z e offset explícito) é aceito", () => {
    const withZ = validateSinceTimestamp("2026-07-14T20:34:08Z");
    expect(withZ.ok).toBe(true);
    const withOffset = validateSinceTimestamp("2026-07-14T17:34:08-03:00");
    expect(withOffset.ok).toBe(true);
    if (withZ.ok && withOffset.ok) {
      expect(withZ.value.getTime()).toBe(withOffset.value.getTime());
    }
  });
});

describe("Diagnóstico de associação prematura (§6, item 30)", () => {
  it("30 — só classifica como prematura quando há claim para a mesma empresa E nenhuma membership ACTIVE para ela", () => {
    expect(
      isPrematureAssociation({ userCompanyId: null, claimCompanyIds: ["c1"], activeMembershipCompanyIds: [] }),
    ).toBe(false); // sem companyId preenchido, nunca é prematura (é exatamente o estado correto pós-1.4C.1)

    expect(
      isPrematureAssociation({ userCompanyId: "c1", claimCompanyIds: ["c1"], activeMembershipCompanyIds: [] }),
    ).toBe(true); // companyId aponta pra empresa reivindicada, sem membership real — o caso que este diagnóstico existe pra achar

    expect(
      isPrematureAssociation({ userCompanyId: "c1", claimCompanyIds: ["c1"], activeMembershipCompanyIds: ["c1"] }),
    ).toBe(false); // tem membership ACTIVE de verdade — legítimo (passou por approveCompanyClaimRequest)

    expect(
      isPrematureAssociation({ userCompanyId: "c2", claimCompanyIds: ["c1"], activeMembershipCompanyIds: [] }),
    ).toBe(false); // companyId aponta pra OUTRA empresa (não a reivindicada) — fora do escopo deste diagnóstico
  });
});

describe("Auditoria — access_denied e invalid_transition (§11, itens 31-33)", () => {
  it("31 — tentativa de CONTINUE sem claim aprovada emite company_claim.access_denied", async () => {
    const company = await createTestCompanyWithRoles("audit-continue-no-approval");
    companyIds.push(company.id);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const rawAdmin = await createTestUserWithMembership(company.id, "audit-continue-no-approval-admin");
    await assignSystemRole(rawAdmin.id, company.id, "ADMIN");
    const admin = toSessionUser(rawAdmin);

    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__ audit-continue-p", active: true } });
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

    const auditEvent = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "company_claim.access_denied" },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.metadata).toMatchObject({ attemptedAction: "resolveClaimDecision:CONTINUE" });
  });

  it("32 — aprovação de claim já revisada emite company_claim.invalid_transition", async () => {
    const company = await makeUnclaimedCompany("audit-invalid-transition-approve");
    const requester = await makeRequester(company.id, "audit-invalid-transition-approve-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    const reviewer = await makeRequester(company.id, "audit-invalid-transition-approve-reviewer");
    await claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    // Segunda aprovação da MESMA claim, já APPROVED.
    await expect(
      claimRequestLib.approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } }),
    ).rejects.toThrow();

    const auditEvent = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "company_claim.invalid_transition", targetId: claim.id },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.metadata).toMatchObject({ attemptedAction: "approve", fromStatus: "APPROVED" });
  });

  it("32 — cancelamento de claim já concluída emite company_claim.invalid_transition", async () => {
    const company = await makeUnclaimedCompany("audit-invalid-transition-cancel");
    const requester = await makeRequester(company.id, "audit-invalid-transition-cancel-r");
    const { claim } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    await claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } });

    await expect(
      claimRequestLib.cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } }),
    ).rejects.toThrow();

    const auditEvent = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "company_claim.invalid_transition", targetId: claim.id, metadata: { path: ["attemptedAction"], equals: "cancel" } },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("33 — nenhum evento de auditoria desta suíte contém CNPJ integral", async () => {
    const company = await makeUnclaimedCompany("audit-no-full-cnpj");
    const cnpj = "11444777000161"; // CNPJ fictício válido, só para este teste de formato
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });
    const requester = await makeRequester(company.id, "audit-no-full-cnpj-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const events = await prisma.auditLog.findMany({ where: { companyId: company.id } });
    for (const event of events) {
      expect(JSON.stringify(event.metadata ?? {})).not.toContain(cnpj);
      expect(event.targetLabel ?? "").not.toContain(cnpj);
    }
  });
});

describe("Multiempresa e seletor de empresa — usuário com claim pendente nunca aparece nem define contexto ativo", () => {
  it("listAvailableCompanyContexts nunca inclui a Company de uma claim pendente (sem membership)", async () => {
    const { listAvailableCompanyContexts } = await import("@/lib/company-selection");
    const company = await makeUnclaimedCompany("selector-claim-pending");
    const requester = await makeRequester(company.id, "selector-claim-pending-r");
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const available = await listAvailableCompanyContexts(requester.id);
    expect(available.some((c) => c.companyId === company.id)).toBe(false);
  });
});
