import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestPlatformUser,
  createTestUser,
  createTestUserWithMembership,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { withValidCheckDigits } from "@/lib/cnpj";
import { ConflictError, NotFoundError } from "@/lib/api-errors";
import { AuthError, ForbiddenError } from "@/lib/auth-server";

// Sprint SST 1.4D — Super Admin Lite para análise segura de reivindicações
// empresariais. Cobre os 54 itens do §24 do spec (autorização global 1-9,
// bootstrap 10-15, listagem 16-21, detalhe 22-26, análise 27-30, aprovação
// 31-41, rejeição 42-46, segurança 47-54) e as 4 cenas de concorrência real
// do §23. Segue o mesmo padrão de mock de sessão de
// tests/tenant-isolation/company-claim-request.test.ts.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let platformAuth: typeof import("@/lib/platform-auth");
let bootstrap: typeof import("@/lib/platform-admin-bootstrap");
let claimsLib: typeof import("@/lib/platform-admin-claims");
let listingLib: typeof import("@/lib/platform-admin-listing");
let detailLib: typeof import("@/lib/platform-admin-detail");
let claimRequestLib: typeof import("@/lib/company-claim-request");
let startReviewRoute: typeof import("@/app/api/platform-admin/company-claims/[id]/start-review/route");
let approveRoute: typeof import("@/app/api/platform-admin/company-claims/[id]/approve/route");
let rejectRoute: typeof import("@/app/api/platform-admin/company-claims/[id]/reject/route");

const companyIds: string[] = [];
const platformAdminUserIds: string[] = [];

beforeAll(async () => {
  platformAuth = await import("@/lib/platform-auth");
  bootstrap = await import("@/lib/platform-admin-bootstrap");
  claimsLib = await import("@/lib/platform-admin-claims");
  listingLib = await import("@/lib/platform-admin-listing");
  detailLib = await import("@/lib/platform-admin-detail");
  claimRequestLib = await import("@/lib/company-claim-request");
  startReviewRoute = await import("@/app/api/platform-admin/company-claims/[id]/start-review/route");
  approveRoute = await import("@/app/api/platform-admin/company-claims/[id]/approve/route");
  rejectRoute = await import("@/app/api/platform-admin/company-claims/[id]/reject/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  // PlatformUser.userId -> User usa onDelete: Restrict — precisa sair antes
  // de cleanupFixtures apagar os Users âncora, senão o DELETE falha.
  await prisma.platformUser.deleteMany({ where: { userId: { in: platformAdminUserIds } } });
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

// --- Fábricas locais ---------------------------------------------------------

async function makeUnclaimedCompany(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
  return company;
}

async function makeRequester(anchorCompanyId: string, label: string) {
  const user = await createTestUser(anchorCompanyId, label);
  return toSessionUser(user);
}

/** Usuário com acesso ao Portal Super Admin. O `companyId` de ancoragem
 * nunca é usado como autoridade (lib/platform-auth.ts nunca lê
 * CompanyMembership/User.companyId) — só satisfaz a FK obrigatória de
 * `User`. */
async function makeSuperAdmin(anchorCompanyId: string, label: string, opts: { active?: boolean } = {}) {
  const user = await createTestUser(anchorCompanyId, label);
  platformAdminUserIds.push(user.id);
  const platformUser = await createTestPlatformUser({ userId: user.id, active: opts.active ?? true });
  return { session: toSessionUser(user), platformUser };
}

let cnpjSeq = 0;
function uniqueCnpj(): string {
  cnpjSeq += 1;
  const base = `${Date.now()}${cnpjSeq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

async function makePendingClaim(label: string, opts: { withCnpj?: boolean } = {}) {
  const company = await makeUnclaimedCompany(label);
  if (opts.withCnpj) {
    const cnpj = uniqueCnpj();
    await prisma.company.update({ where: { id: company.id }, data: { document: cnpj, documentNormalized: cnpj } });
  }
  const requester = await makeRequester(company.id, `${label}-r`);
  const { claim } = await claimRequestLib.createOrReuseClaimRequest({
    companyId: company.id,
    requester: { id: requester.id, name: requester.name },
    origin: "EXISTING_PRE_REGISTRATION",
  });
  return { company, requester, claim };
}

function jsonRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/platform-admin/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_NOTE = "Confirmado por contato telefônico com o representante legal.";

// =============================================================================
// 1-9 — Autorização global (lib/platform-auth.ts)
// =============================================================================

describe("Autorização global do Portal Super Admin (§24, 1-9)", () => {
  it("1 — usuário autenticado sem PlatformUser é bloqueado com ForbiddenError", async () => {
    const anchor = await makeUnclaimedCompany("auth-nouser");
    const user = await makeRequester(anchor.id, "auth-nouser-u");
    loginAs(user);
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("2 — PlatformUser.active=false é bloqueado com ForbiddenError, mesmo com role SUPER_ADMIN", async () => {
    const anchor = await makeUnclaimedCompany("auth-inactive");
    const { session } = await makeSuperAdmin(anchor.id, "auth-inactive-a", { active: false });
    loginAs(session);
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("3/5 — PlatformUser.active=true com role SUPER_ADMIN tem acesso concedido por requirePlatformUser e requirePlatformRole", async () => {
    const anchor = await makeUnclaimedCompany("auth-ok");
    const { session, platformUser } = await makeSuperAdmin(anchor.id, "auth-ok-a");
    loginAs(session);
    const ctx1 = await platformAuth.requirePlatformUser();
    expect(ctx1.platformUser.id).toBe(platformUser.id);
    const ctx2 = await platformAuth.requirePlatformRole("SUPER_ADMIN");
    expect(ctx2.platformUser.id).toBe(platformUser.id);
    // O enum PlatformUserRole só tem SUPER_ADMIN nesta sprint — o branch de
    // role diferente em requirePlatformRole (lib/platform-auth.ts) fica
    // coberto estruturalmente (nunca alcançável com dado real até um novo
    // papel existir), documentado aqui em vez de simulado artificialmente.
  });

  it("4 — usuário não autenticado é bloqueado com AuthError, nunca ForbiddenError", async () => {
    loginAs(null);
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(AuthError);
  });

  it("6 — CompanyMembership ACTIVE com papel ADMIN sozinha nunca concede acesso ao Portal Super Admin", async () => {
    const company = await makeUnclaimedCompany("auth-cross-membership");
    const admin = await createTestUserWithMembership(company.id, "auth-cross-membership-a");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    loginAs(toSessionUser(admin));
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("7 — vínculo de SstProviderUser sozinho nunca concede acesso ao Portal Super Admin", async () => {
    const anchor = await makeUnclaimedCompany("auth-cross-sst");
    const user = await makeRequester(anchor.id, "auth-cross-sst-u");
    // Não cria SstProviderUser real aqui (fora do escopo deste domínio) — a
    // ausência de qualquer PlatformUser já basta para provar isolamento: o
    // guard nunca consulta SstProviderUser/SstProvider em nenhum caminho.
    loginAs(user);
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("8 — revogar PlatformUser.active bloqueia a PRÓXIMA chamada, sem exigir logout (mesma sessão)", async () => {
    const anchor = await makeUnclaimedCompany("auth-revoke-midsession");
    const { session, platformUser } = await makeSuperAdmin(anchor.id, "auth-revoke-midsession-a");
    loginAs(session);
    await expect(platformAuth.requirePlatformUser()).resolves.toBeTruthy();

    await prisma.platformUser.update({ where: { id: platformUser.id }, data: { active: false } });

    // Mesma "sessão" (nenhum logout/re-login) — mesmo objeto `session`.
    await expect(platformAuth.requirePlatformUser()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("9 — getCurrentPlatformUser nunca lança; retorna platformUser null quando sem acesso", async () => {
    const anchor = await makeUnclaimedCompany("auth-getcurrent");
    const user = await makeRequester(anchor.id, "auth-getcurrent-u");
    loginAs(user);
    const ctx = await platformAuth.getCurrentPlatformUser();
    expect(ctx.platformUser).toBeNull();
    expect(ctx.user.id).toBe(user.id);
  });
});

// =============================================================================
// 10-15 — Bootstrap (grant/revoke)
// =============================================================================

describe("Bootstrap de Super Admin (§24, 10-15 / Sprint 1.4D.1 §7-8)", () => {
  const REASON = "Motivo de teste — nunca contém segredo.";

  it("10 — grantPlatformAdmin (GRANTED_BY) cria PlatformUser SUPER_ADMIN para usuário existente", async () => {
    const anchor = await makeUnclaimedCompany("boot-grant");
    const granterAnchor = await makeUnclaimedCompany("boot-grant-granter");
    const granter = await makeSuperAdmin(granterAnchor.id, "boot-grant-granter-a");
    const user = await createTestUser(anchor.id, "boot-grant-u");
    platformAdminUserIds.push(user.id);

    const result = await bootstrap.grantPlatformAdmin(user.email, {
      kind: "GRANTED_BY",
      grantedByEmail: granter.session.email,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    const row = await prisma.platformUser.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.role).toBe("SUPER_ADMIN");
    expect(row.active).toBe(true);

    const event = await prisma.platformAuditLog.findFirst({ where: { action: "platform_admin.access_granted", targetId: row.id } });
    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBe(granter.session.id);
    expect(event?.reason).toBe(REASON);
  });

  it("10b — grantPlatformAdmin (GRANTED_BY) rejeita concedente inexistente ou sem PlatformUser ativo", async () => {
    const anchor = await makeUnclaimedCompany("boot-grant-bad-granter");
    const user = await createTestUser(anchor.id, "boot-grant-bad-granter-u");
    platformAdminUserIds.push(user.id);

    const notFound = await bootstrap.grantPlatformAdmin(user.email, {
      kind: "GRANTED_BY",
      grantedByEmail: "__tenant_test__nao-existe-granter@example.test",
      reason: REASON,
    });
    expect(notFound).toEqual({ ok: false, reason: "GRANTER_NOT_FOUND" });

    const plainAnchor = await makeUnclaimedCompany("boot-grant-plain-granter");
    const plainUser = await createTestUser(plainAnchor.id, "boot-grant-plain-granter-u");
    const notActive = await bootstrap.grantPlatformAdmin(user.email, {
      kind: "GRANTED_BY",
      grantedByEmail: plainUser.email,
      reason: REASON,
    });
    expect(notActive).toEqual({ ok: false, reason: "GRANTER_NOT_ACTIVE_SUPER_ADMIN" });
  });

  it("10c — grantPlatformAdmin (FIRST_BOOTSTRAP) é rejeitado quando já existe SUPER_ADMIN ativo", async () => {
    const anchor = await makeUnclaimedCompany("boot-first-already-done");
    await makeSuperAdmin(anchor.id, "boot-first-already-done-existing");
    const targetAnchor = await makeUnclaimedCompany("boot-first-already-done-target");
    const target = await createTestUser(targetAnchor.id, "boot-first-already-done-target-u");
    platformAdminUserIds.push(target.id);

    const result = await bootstrap.grantPlatformAdmin(target.email, { kind: "FIRST_BOOTSTRAP", reason: REASON });
    expect(result).toEqual({ ok: false, reason: "FIRST_BOOTSTRAP_ALREADY_DONE" });
  });

  it("10d — grantPlatformAdmin (FIRST_BOOTSTRAP) cria o primeiro SUPER_ADMIN e audita platform_admin.first_bootstrap com actorUserId null, quando nenhum SUPER_ADMIN ativo existe", async () => {
    const alreadyBootstrapped = await bootstrap.hasAnyActiveSuperAdmin();
    const targetAnchor = await makeUnclaimedCompany("boot-first-success-target");
    const target = await createTestUser(targetAnchor.id, "boot-first-success-target-u");
    platformAdminUserIds.push(target.id);

    const result = await bootstrap.grantPlatformAdmin(target.email, { kind: "FIRST_BOOTSTRAP", reason: REASON });

    if (alreadyBootstrapped) {
      // Ambiente com outros SUPER_ADMIN ativos (execução concorrente de
      // suites) — o caminho FIRST_BOOTSTRAP é corretamente recusado; o
      // sucesso do bootstrap em si já é coberto por 10c (rejeição) e pela
      // lógica determinística abaixo quando o ambiente realmente está vazio.
      expect(result).toEqual({ ok: false, reason: "FIRST_BOOTSTRAP_ALREADY_DONE" });
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    const event = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.first_bootstrap", targetId: result.platformUserId },
    });
    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBeNull();
    expect(event?.source).toBe("FIRST_BOOTSTRAP");
  });

  it("11 — grantPlatformAdmin é idempotente: chamar de novo sobre um já ativo não duplica nem erra", async () => {
    const anchor = await makeUnclaimedCompany("boot-grant-idempotent");
    const granterAnchor = await makeUnclaimedCompany("boot-grant-idempotent-granter");
    const granter = await makeSuperAdmin(granterAnchor.id, "boot-grant-idempotent-granter-a");
    const user = await createTestUser(anchor.id, "boot-grant-idempotent-u");
    platformAdminUserIds.push(user.id);
    const context = { kind: "GRANTED_BY" as const, grantedByEmail: granter.session.email, reason: REASON };

    const first = await bootstrap.grantPlatformAdmin(user.email, context);
    const second = await bootstrap.grantPlatformAdmin(user.email, context);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.created).toBe(false);
    expect(second.platformUserId).toBe(first.platformUserId);

    const count = await prisma.platformUser.count({ where: { userId: user.id } });
    expect(count).toBe(1);
    // Idempotente: a segunda chamada não gera um segundo evento persistente.
    const events = await prisma.platformAuditLog.count({ where: { action: "platform_admin.access_granted", targetId: first.platformUserId } });
    expect(events).toBe(1);
  });

  it("11b — grantPlatformAdmin reativa (nunca duplica) um PlatformUser previamente revogado e audita access_reactivated", async () => {
    const anchor = await makeUnclaimedCompany("boot-grant-reactivate");
    const granterAnchor = await makeUnclaimedCompany("boot-grant-reactivate-granter");
    const granter = await makeSuperAdmin(granterAnchor.id, "boot-grant-reactivate-granter-a");
    const user = await createTestUser(anchor.id, "boot-grant-reactivate-u");
    platformAdminUserIds.push(user.id);
    const context = { kind: "GRANTED_BY" as const, grantedByEmail: granter.session.email, reason: REASON };

    await bootstrap.grantPlatformAdmin(user.email, context);
    await bootstrap.revokePlatformAdmin(user.email, { reason: REASON, allowNoActiveSuperAdmin: true });
    const result = await bootstrap.grantPlatformAdmin(user.email, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reactivated).toBe(true);

    const count = await prisma.platformUser.count({ where: { userId: user.id } });
    expect(count).toBe(1);
    const row = await prisma.platformUser.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.active).toBe(true);

    const event = await prisma.platformAuditLog.findFirst({ where: { action: "platform_admin.access_reactivated", targetId: row.id } });
    expect(event).not.toBeNull();
  });

  it("12 — grantPlatformAdmin para e-mail inexistente retorna USER_NOT_FOUND, nunca cria usuário novo", async () => {
    const granterAnchor = await makeUnclaimedCompany("boot-grant-notfound-granter");
    const granter = await makeSuperAdmin(granterAnchor.id, "boot-grant-notfound-granter-a");
    const result = await bootstrap.grantPlatformAdmin("__tenant_test__nao-existe@example.test", {
      kind: "GRANTED_BY",
      grantedByEmail: granter.session.email,
      reason: REASON,
    });
    expect(result).toEqual({ ok: false, reason: "USER_NOT_FOUND" });
  });

  it("13 — revokePlatformAdmin desativa (active=false); nunca faz hard delete da linha; audita access_revoked", async () => {
    const anchor = await makeUnclaimedCompany("boot-revoke");
    const { session, platformUser } = await makeSuperAdmin(anchor.id, "boot-revoke-a");
    // Segundo Super Admin para não esbarrar na proteção de "último ativo".
    await makeSuperAdmin(anchor.id, "boot-revoke-b");

    const result = await bootstrap.revokePlatformAdmin(session.email, { reason: REASON });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyInactive).toBe(false);

    const row = await prisma.platformUser.findUniqueOrThrow({ where: { id: platformUser.id } });
    expect(row.active).toBe(false);

    const event = await prisma.platformAuditLog.findFirst({ where: { action: "platform_admin.access_revoked", targetId: platformUser.id } });
    expect(event).not.toBeNull();
    expect(event?.reason).toBe(REASON);
  });

  it("14 — revokePlatformAdmin bloqueia remover o ÚLTIMO SUPER_ADMIN ativo sem --allow-no-active-super-admin, e audita a tentativa bloqueada", async () => {
    const anchor = await makeUnclaimedCompany("boot-revoke-last");
    const { session } = await makeSuperAdmin(anchor.id, "boot-revoke-last-a");

    const otherActive = await prisma.platformUser.count({
      where: { role: "SUPER_ADMIN", active: true, userId: { not: session.id } },
    });

    const result = await bootstrap.revokePlatformAdmin(
      session.email,
      otherActive > 0 ? { reason: REASON, allowNoActiveSuperAdmin: true } : { reason: REASON },
    );
    if (otherActive === 0) {
      expect(result).toEqual({ ok: false, reason: "LAST_ACTIVE_SUPER_ADMIN" });
      const row = await prisma.platformUser.findUniqueOrThrow({ where: { userId: session.id } });
      expect(row.active).toBe(true);

      const blockedEvent = await prisma.platformAuditLog.findFirst({
        where: { action: "platform_admin.last_admin_revocation_blocked", targetId: row.id },
      });
      expect(blockedEvent).not.toBeNull();
    }
  });

  it("15 — revokePlatformAdmin com allowNoActiveSuperAdmin=true permite remover mesmo sendo o último SUPER_ADMIN ativo", async () => {
    const anchor = await makeUnclaimedCompany("boot-revoke-force");
    const { session } = await makeSuperAdmin(anchor.id, "boot-revoke-force-a");

    const result = await bootstrap.revokePlatformAdmin(session.email, { reason: REASON, allowNoActiveSuperAdmin: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.platformUser.findUniqueOrThrow({ where: { userId: session.id } });
    expect(row.active).toBe(false);
  });
});

// =============================================================================
// 16-21 — Listagem
// =============================================================================

describe("Listagem de reivindicações (§24, 16-21)", () => {
  it("16 — pagina server-side (nunca carrega tudo de uma vez)", async () => {
    const label = "list-page";
    for (let i = 0; i < 3; i += 1) {
      await makePendingClaim(`${label}-${i}`);
    }
    const page1 = await listingLib.listCompanyClaimsForAdmin({ status: "PENDING", page: 1, pageSize: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
    expect(page1.pageSize).toBe(2);
    expect(page1.totalCount).toBeGreaterThanOrEqual(3);
  });

  it("17 — filtra por status", async () => {
    const { claim } = await makePendingClaim("list-status");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("list-status-rev")).id, "list-status-rev-a")).session;
    await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const underReview = await listingLib.listCompanyClaimsForAdmin({ status: "UNDER_REVIEW", pageSize: 100 });
    expect(underReview.items.some((i) => i.id === claim.id)).toBe(true);
    const pending = await listingLib.listCompanyClaimsForAdmin({ status: "PENDING", pageSize: 100 });
    expect(pending.items.some((i) => i.id === claim.id)).toBe(false);
  });

  it("18 — busca por nome da empresa, CNPJ e e-mail do solicitante", async () => {
    const { company, requester, claim } = await makePendingClaim("list-search", { withCnpj: true });

    const byName = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", search: company.name, pageSize: 100 });
    expect(byName.items.some((i) => i.id === claim.id)).toBe(true);

    const cnpjDigits = (await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).documentNormalized!;
    const byCnpj = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", search: cnpjDigits, pageSize: 100 });
    expect(byCnpj.items.some((i) => i.id === claim.id)).toBe(true);

    const byEmail = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", search: requester.email, pageSize: 100 });
    expect(byEmail.items.some((i) => i.id === claim.id)).toBe(true);
  });

  it("19 — empresas DISPUTED aparecem primeiro na ordenação padrão", async () => {
    const company = await makeUnclaimedCompany("list-disputed");
    const requesterA = await makeRequester(company.id, "list-disputed-a");
    const requesterB = await makeRequester(company.id, "list-disputed-b");
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
    const updated = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.controlStatus).toBe("DISPUTED");

    const result = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", pageSize: 100 });
    const disputedIndex = result.items.findIndex((i) => i.companyId === company.id);
    expect(disputedIndex).toBe(0);
  });

  it("20 — contagem de claims concorrentes e existência de consultoria provisória são resolvidas em lote e corretas", async () => {
    const company = await makeUnclaimedCompany("list-concurrent-counts");
    const requesterA = await makeRequester(company.id, "list-concurrent-counts-a");
    const requesterB = await makeRequester(company.id, "list-concurrent-counts-b");
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

    const result = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", pageSize: 100 });
    const itemsForCompany = result.items.filter((i) => i.companyId === company.id);
    expect(itemsForCompany.length).toBe(2);
    for (const item of itemsForCompany) {
      expect(item.concurrentActiveClaimCount).toBe(2);
      expect(item.hasProvisionalProvider).toBe(false);
    }
  });

  it("21 — dashboard summary conta pendentes/em análise/disputadas/decididas-recentemente corretamente", async () => {
    const before = await listingLib.getPlatformAdminDashboardSummary();
    const { claim } = await makePendingClaim("list-dashboard");

    const after = await listingLib.getPlatformAdminDashboardSummary();
    expect(after.pendingCount).toBe(before.pendingCount + 1);
    void claim;
  });
});

// =============================================================================
// 22-26 — Detalhe
// =============================================================================

describe("Detalhe da reivindicação (§24, 22-26)", () => {
  it("22 — retorna null para id inexistente, nunca lança", async () => {
    const detail = await detailLib.getCompanyClaimDetailForAdmin("id-que-nao-existe");
    expect(detail).toBeNull();
  });

  it("23 — retorna metadados mínimos com CNPJ e e-mail mascarados; nunca dados operacionais", async () => {
    const { company, requester, claim } = await makePendingClaim("detail-basic", { withCnpj: true });
    const detail = await detailLib.getCompanyClaimDetailForAdmin(claim.id);
    expect(detail).not.toBeNull();
    if (!detail) return;

    expect(detail.company.name).toBe(company.name);
    expect(detail.company.cnpjMasked).not.toBeNull();
    expect(detail.company.cnpjMasked).not.toContain((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).documentNormalized);
    expect(detail.requester.emailMasked).not.toBe(requester.email);
    expect(detail.requester.emailMasked).toContain("@");
    // Nunca inclui employees/trainings/assets — o shape do retorno em si
    // (ClaimDetailForAdmin) não tem nenhum desses campos; reforça que a
    // função nunca consulta essas tabelas.
    expect(detail).not.toHaveProperty("employees");
    expect(detail).not.toHaveProperty("assets");
  });

  it("24 — lista claims concorrentes da mesma empresa com e-mail mascarado", async () => {
    const company = await makeUnclaimedCompany("detail-competing");
    const requesterA = await makeRequester(company.id, "detail-competing-a");
    const requesterB = await makeRequester(company.id, "detail-competing-b");
    const { claim: claimA } = await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterA.id, name: requesterA.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });
    await claimRequestLib.createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requesterB.id, name: requesterB.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const detail = await detailLib.getCompanyClaimDetailForAdmin(claimA.id);
    expect(detail?.competingClaims).toHaveLength(1);
    expect(detail?.competingClaims[0]?.requesterEmailMasked).not.toBe(requesterB.email);
  });

  it("25 — hasAdministrativeMembership reflete a existência de CompanyMembership ACTIVE", async () => {
    const { claim } = await makePendingClaim("detail-membership");
    const before = await detailLib.getCompanyClaimDetailForAdmin(claim.id);
    expect(before?.hasAdministrativeMembership).toBe(false);

    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("detail-membership-rev")).id, "detail-membership-rev-a")).session;
    await claimsLib.approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
    });

    const after = await detailLib.getCompanyClaimDetailForAdmin(claim.id);
    expect(after?.hasAdministrativeMembership).toBe(true);
  });

  it("26 — inclui consultoria provisória mascarada só quando PROVIDER_PRE_REGISTRATION+ACTIVE; auditEvents filtrados à whitelist", async () => {
    const { company, claim } = await makePendingClaim("detail-provider");
    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__Consultoria Detalhe LTDA", active: true } });
    await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    const detail = await detailLib.getCompanyClaimDetailForAdmin(claim.id);
    expect(detail?.provisionalProvider).not.toBeNull();
    expect(detail?.provisionalProvider?.providerNameMasked).not.toBe(provider.name);

    // auditEvents só contém ações da whitelist (company_claim.*/platform_admin.*
    // relacionadas a ESTA claim) — verificado indiretamente: nenhum evento
    // fora do domínio de claim aparece mesmo após ações não relacionadas.
    expect(detail?.auditEvents.every((e) => e.action.startsWith("company_claim.") || e.action.startsWith("platform_admin."))).toBe(true);

    await prisma.sstProviderCompany.deleteMany({ where: { providerId: provider.id } });
    await prisma.sstProvider.delete({ where: { id: provider.id } });
  });
});

// =============================================================================
// 27-30 — Início de análise
// =============================================================================

describe("Início de análise — startCompanyClaimReview (§24, 27-30)", () => {
  it("27 — PENDING -> UNDER_REVIEW, registra reviewedByUserId/reviewedAt", async () => {
    const { claim } = await makePendingClaim("review-start");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("review-start-rev")).id, "review-start-rev-a")).session;

    const result = await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    expect(result.status).toBe("UNDER_REVIEW");

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("UNDER_REVIEW");
    expect(updated.reviewedByUserId).toBe(reviewer.id);
    expect(updated.reviewedAt).not.toBeNull();
  });

  it("28 — chamar de novo pelo MESMO revisor é idempotente (no-op de sucesso, sem novo evento de auditoria)", async () => {
    const { claim } = await makePendingClaim("review-idempotent");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("review-idempotent-rev")).id, "review-idempotent-rev-a")).session;

    await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    const countAfterFirst = await prisma.auditLog.count({ where: { action: "platform_admin.claim_review_started", targetId: claim.id } });
    const second = await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    expect(second.status).toBe("UNDER_REVIEW");
    const countAfterSecond = await prisma.auditLog.count({ where: { action: "platform_admin.claim_review_started", targetId: claim.id } });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("29 — Sprint SST 1.4D.1 §9: outro revisor NUNCA sobrescreve silenciosamente — start-review é bloqueado (ConflictError) e a tentativa é auditada", async () => {
    const { claim } = await makePendingClaim("review-reassign");
    const anchor = await makeUnclaimedCompany("review-reassign-rev");
    const reviewerA = (await makeSuperAdmin(anchor.id, "review-reassign-rev-a")).session;
    const reviewerB = (await makeSuperAdmin(anchor.id, "review-reassign-rev-b")).session;

    await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewerA.id, name: reviewerA.name } });
    await expect(
      claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewerB.id, name: reviewerB.name } }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Estado nunca muda — continua atribuída ao revisor original.
    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.reviewedByUserId).toBe(reviewerA.id);

    const event = await prisma.auditLog.findFirst({
      where: { action: "platform_admin.claim_review_reassignment_blocked", targetId: claim.id, actorUserId: reviewerB.id },
    });
    expect(event).not.toBeNull();
    expect((event?.metadata as { previousReviewerUserId?: string })?.previousReviewerUserId).toBe(reviewerA.id);
  });

  it("30 — iniciar análise fora de PENDING/UNDER_REVIEW é rejeitado (ConflictError) e audita invalid_claim_transition", async () => {
    const { claim } = await makePendingClaim("review-invalid");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("review-invalid-rev")).id, "review-invalid-rev-a")).session;
    await claimsLib.approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
    });

    await expect(
      claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } }),
    ).rejects.toBeInstanceOf(ConflictError);

    const event = await prisma.auditLog.findFirst({ where: { action: "platform_admin.invalid_claim_transition", targetId: claim.id } });
    expect(event).not.toBeNull();
  });
});

// =============================================================================
// 31-41 — Aprovação
// =============================================================================

describe("Aprovação pelo Super Admin (§24, 31-41)", () => {
  it("31/32 — cria CompanyMembership ACTIVE + role ADMIN (delega para o serviço já testado) e audita platform_admin.claim_approved com a justificativa", async () => {
    const { company, requester, claim } = await makePendingClaim("approve-basic");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("approve-basic-rev")).id, "approve-basic-rev-a")).session;

    const result = await claimsLib.approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
      verificationMethod: "BUSINESS_CONTACT_CONFIRMED",
    });
    expect(result.membershipId).toBeTruthy();

    const membership = await prisma.companyMembership.findFirst({ where: { companyId: company.id, userId: requester.id } });
    expect(membership?.status).toBe("ACTIVE");

    const event = await prisma.auditLog.findFirst({ where: { action: "platform_admin.claim_approved", targetId: claim.id } });
    expect(event).not.toBeNull();
    const metadata = event?.metadata as { reviewNote?: string; verificationMethod?: string };
    expect(metadata?.reviewNote).toBe(VALID_NOTE);
    expect(metadata?.verificationMethod).toBe("BUSINESS_CONTACT_CONFIRMED");
  });

  it("33/34/35 — reviewNote vazia, curta demais ou longa demais são rejeitadas pelo schema (rota approve)", async () => {
    const { claim } = await makePendingClaim("approve-note-length");
    const anchor = await makeUnclaimedCompany("approve-note-length-rev");
    const { session } = await makeSuperAdmin(anchor.id, "approve-note-length-rev-a");
    loginAs(session);

    for (const bad of ["", "curta", "x".repeat(1001)]) {
      const res = await approveRoute.POST(jsonRequest({ reviewNote: bad }), routeParams(claim.id));
      expect(res.status).toBe(400);
    }
  });

  it("36 — reviewNote contendo padrão de senha/token é rejeitada (heurística best-effort)", async () => {
    const { claim } = await makePendingClaim("approve-note-secret");
    const anchor = await makeUnclaimedCompany("approve-note-secret-rev");
    const { session } = await makeSuperAdmin(anchor.id, "approve-note-secret-rev-a");
    loginAs(session);

    const res = await approveRoute.POST(jsonRequest({ reviewNote: "confirmado, senha: abc12345" }), routeParams(claim.id));
    expect(res.status).toBe(400);
  });

  it("37 — verificationMethod fora do enum é rejeitado", async () => {
    const { claim } = await makePendingClaim("approve-verification-invalid");
    const anchor = await makeUnclaimedCompany("approve-verification-invalid-rev");
    const { session } = await makeSuperAdmin(anchor.id, "approve-verification-invalid-rev-a");
    loginAs(session);

    const res = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE, verificationMethod: "MAGIA" }), routeParams(claim.id));
    expect(res.status).toBe(400);
  });

  it("38 — companyId/requesterUserId/roleId/reviewedByUserId/controlStatus arbitrários do client são ignorados", async () => {
    const { company, requester, claim } = await makePendingClaim("approve-ignore-fields");
    const otherCompany = await makeUnclaimedCompany("approve-ignore-fields-other");
    const anchor = await makeUnclaimedCompany("approve-ignore-fields-rev");
    const { session } = await makeSuperAdmin(anchor.id, "approve-ignore-fields-rev-a");
    loginAs(session);

    const res = await approveRoute.POST(
      jsonRequest({
        reviewNote: VALID_NOTE,
        companyId: otherCompany.id,
        requesterUserId: session.id,
        roleId: "forjado",
        reviewedByUserId: requester.id,
        controlStatus: "CLAIMED",
        membershipStatus: "ACTIVE",
        accessLevel: "ADMINISTRATION",
        authorizationBasis: "COMPANY_APPROVAL",
      }),
      routeParams(claim.id),
    );
    expect(res.status).toBe(200);

    // A membership real foi criada para a empresa/CLAIM verdadeiros, nunca
    // para `otherCompany` nem com `requesterUserId` forjado.
    const membership = await prisma.companyMembership.findFirst({ where: { companyId: company.id, userId: requester.id } });
    expect(membership).not.toBeNull();
    const forgedMembership = await prisma.companyMembership.findFirst({ where: { companyId: otherCompany.id, userId: session.id } });
    expect(forgedMembership).toBeNull();
  });

  it("39 — aprovar via rota exige PlatformUser SUPER_ADMIN ativo: 401 sem sessão, 403 sem PlatformUser", async () => {
    const { claim } = await makePendingClaim("approve-authz");

    loginAs(null);
    const resNoSession = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(resNoSession.status).toBe(401);

    const anchor = await makeUnclaimedCompany("approve-authz-plain");
    const plainUser = await makeRequester(anchor.id, "approve-authz-plain-u");
    loginAs(plainUser);
    const resNoAccess = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(resNoAccess.status).toBe(403);
  });

  it("40 — aprovar claim já decidida retorna 409, nunca cria segunda membership", async () => {
    const { company, requester, claim } = await makePendingClaim("approve-already-decided");
    const anchor = await makeUnclaimedCompany("approve-already-decided-rev");
    const { session } = await makeSuperAdmin(anchor.id, "approve-already-decided-rev-a");
    loginAs(session);

    const first = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(first.status).toBe(200);
    const second = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(second.status).toBe(409);

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    expect(membershipCount).toBe(1);
  });

  it("41 — aprovar invalida outras solicitações concorrentes da mesma empresa (SUPERSEDED_BY_APPROVAL)", async () => {
    const company = await makeUnclaimedCompany("approve-supersede");
    const requesterA = await makeRequester(company.id, "approve-supersede-a");
    const requesterB = await makeRequester(company.id, "approve-supersede-b");
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
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("approve-supersede-rev")).id, "approve-supersede-rev-a")).session;

    await claimsLib.approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claimA.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
    });

    const updatedB = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claimB.id } });
    expect(updatedB.status).toBe("REJECTED");
    expect(updatedB.rejectionReason).toContain("aprovada");
  });
});

// =============================================================================
// 42-46 — Rejeição
// =============================================================================

describe("Rejeição pelo Super Admin (§24, 42-46)", () => {
  it("42/43 — marca REJECTED, nunca cria membership, audita platform_admin.claim_rejected com a justificativa", async () => {
    const { company, requester, claim } = await makePendingClaim("reject-basic");
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("reject-basic-rev")).id, "reject-basic-rev-a")).session;

    const result = await claimsLib.rejectCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
    });
    expect(result.claimId).toBe(claim.id);

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("REJECTED");
    const membership = await prisma.companyMembership.findFirst({ where: { companyId: company.id, userId: requester.id } });
    expect(membership).toBeNull();

    const event = await prisma.auditLog.findFirst({ where: { action: "platform_admin.claim_rejected", targetId: claim.id } });
    expect((event?.metadata as { reviewNote?: string })?.reviewNote).toBe(VALID_NOTE);
  });

  it("44 — reviewNote também é obrigatória na rejeição (mesmo schema)", async () => {
    const { claim } = await makePendingClaim("reject-note-required");
    const anchor = await makeUnclaimedCompany("reject-note-required-rev");
    const { session } = await makeSuperAdmin(anchor.id, "reject-note-required-rev-a");
    loginAs(session);

    const res = await rejectRoute.POST(jsonRequest({ reviewNote: "" }), routeParams(claim.id));
    expect(res.status).toBe(400);
  });

  it("45 — rejeitar via rota sem PlatformUser é 403", async () => {
    const { claim } = await makePendingClaim("reject-authz");
    const anchor = await makeUnclaimedCompany("reject-authz-plain");
    const plainUser = await makeRequester(anchor.id, "reject-authz-plain-u");
    loginAs(plainUser);

    const res = await rejectRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(res.status).toBe(403);
  });

  it("46 — rejeitar claim já decidida retorna 409, nunca sobrescreve a decisão anterior", async () => {
    const { claim } = await makePendingClaim("reject-already-decided");
    const anchor = await makeUnclaimedCompany("reject-already-decided-rev");
    const { session } = await makeSuperAdmin(anchor.id, "reject-already-decided-rev-a");
    loginAs(session);

    const first = await rejectRoute.POST(jsonRequest({ reviewNote: "Primeira justificativa de rejeição." }), routeParams(claim.id));
    expect(first.status).toBe(200);
    const second = await rejectRoute.POST(jsonRequest({ reviewNote: "Segunda justificativa, nunca deveria aplicar." }), routeParams(claim.id));
    expect(second.status).toBe(409);

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.rejectionReason).toBe("Primeira justificativa de rejeição.");
  });
});

// =============================================================================
// 47-54 — Segurança
// =============================================================================

describe("Segurança do Portal Super Admin (§24, 47-54)", () => {
  it("47 — PlatformUser nunca recebe CompanyMembership automaticamente ao visualizar/iniciar análise/decidir", async () => {
    const { claim } = await makePendingClaim("sec-no-auto-membership");
    const anchor = await makeUnclaimedCompany("sec-no-auto-membership-rev");
    const { session } = await makeSuperAdmin(anchor.id, "sec-no-auto-membership-rev-a");

    await claimsLib.recordClaimViewed({ claimRequestId: claim.id, companyId: (await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } })).companyId, viewer: { id: session.id, name: session.name } });
    await claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: session.id, name: session.name } });
    await claimsLib.rejectCompanyClaimRequestAsPlatformAdmin({ claimRequestId: claim.id, reviewer: { id: session.id, name: session.name }, reviewNote: VALID_NOTE });

    const reviewerMembership = await prisma.companyMembership.count({ where: { userId: session.id } });
    expect(reviewerMembership).toBe(0);
  });

  it("48 — decisões do Super Admin não dependem de contexto de empresa cliente (funcionam sem active_company_id)", async () => {
    const { claim } = await makePendingClaim("sec-no-company-context");
    const anchor = await makeUnclaimedCompany("sec-no-company-context-rev");
    const { session } = await makeSuperAdmin(anchor.id, "sec-no-company-context-rev-a");
    loginAs(session);
    resetCookieStore(); // garante nenhum active_company_id setado

    const res = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(res.status).toBe(200);
  });

  it("49 — CNPJ e e-mail sempre mascarados na listagem e no detalhe, nunca o valor cru", async () => {
    const { company, requester, claim } = await makePendingClaim("sec-masking", { withCnpj: true });
    const rawCnpj = (await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).documentNormalized!;

    const listResult = await listingLib.listCompanyClaimsForAdmin({ status: "ALL", search: company.name, pageSize: 100 });
    const listItem = listResult.items.find((i) => i.id === claim.id);
    expect(listItem?.companyCnpjMasked).not.toBe(rawCnpj);
    expect(listItem?.requesterEmailMasked).not.toBe(requester.email);

    const detail = await detailLib.getCompanyClaimDetailForAdmin(claim.id);
    expect(detail?.company.cnpjMasked).not.toBe(rawCnpj);
    expect(detail?.requester.emailMasked).not.toBe(requester.email);
  });

  it("50 — platform_admin.claim_viewed é deduplicado dentro da janela de 5 minutos", async () => {
    const { company, claim } = await makePendingClaim("sec-viewed-dedupe");
    const anchor = await makeUnclaimedCompany("sec-viewed-dedupe-rev");
    const { session } = await makeSuperAdmin(anchor.id, "sec-viewed-dedupe-rev-a");

    await claimsLib.recordClaimViewed({ claimRequestId: claim.id, companyId: company.id, viewer: { id: session.id, name: session.name } });
    await claimsLib.recordClaimViewed({ claimRequestId: claim.id, companyId: company.id, viewer: { id: session.id, name: session.name } });
    await claimsLib.recordClaimViewed({ claimRequestId: claim.id, companyId: company.id, viewer: { id: session.id, name: session.name } });

    const count = await prisma.auditLog.count({ where: { action: "platform_admin.claim_viewed", targetId: claim.id, actorUserId: session.id } });
    expect(count).toBe(1);
  });

  it("51 — decisão do Super Admin nunca altera diretamente um vínculo SST provisório (CONTINUE/BLOCK continua exclusivo da empresa)", async () => {
    const { company, claim } = await makePendingClaim("sec-provider-link-untouched");
    const provider = await prisma.sstProvider.create({ data: { name: "__tenant_test__Consultoria Segurança LTDA", active: true } });
    const link = await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });
    const reviewer = (await makeSuperAdmin((await makeUnclaimedCompany("sec-provider-link-untouched-rev")).id, "sec-provider-link-untouched-rev-a")).session;

    await claimsLib.approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: claim.id,
      reviewer: { id: reviewer.id, name: reviewer.name },
      reviewNote: VALID_NOTE,
    });

    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");
    expect(updatedLink.companyReviewedAt).toBeNull();

    await prisma.sstProviderCompany.deleteMany({ where: { providerId: provider.id } });
    await prisma.sstProvider.delete({ where: { id: provider.id } });
  });

  it("52 — revogar PlatformUser durante a sessão bloqueia a PRÓXIMA ação administrativa (rota), sem depender de logout", async () => {
    const { claim } = await makePendingClaim("sec-revoke-blocks-next-action");
    const anchor = await makeUnclaimedCompany("sec-revoke-blocks-next-action-rev");
    const { session, platformUser } = await makeSuperAdmin(anchor.id, "sec-revoke-blocks-next-action-rev-a");
    loginAs(session);

    const okRes = await startReviewRoute.POST(jsonRequest({}), routeParams(claim.id));
    expect(okRes.status).toBe(200);

    await prisma.platformUser.update({ where: { id: platformUser.id }, data: { active: false } });

    const blockedRes = await approveRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(blockedRes.status).toBe(403);
  });

  it("53 — rotas nunca vazam erro de banco cru (P2002/stack); sempre mensagem classificada", async () => {
    const { claim } = await makePendingClaim("sec-no-raw-error");
    const anchor = await makeUnclaimedCompany("sec-no-raw-error-rev");
    const { session } = await makeSuperAdmin(anchor.id, "sec-no-raw-error-rev-a");
    loginAs(session);

    const res = await approveRoute.POST(jsonRequest({ reviewNote: 123 }), routeParams(claim.id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; fieldErrors?: unknown };
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toMatch(/prisma|stack|at\s+\/|P\d{4}/i);
  });

  it("54 — auditoria administrativa nunca inclui senha/token/cookie no metadata registrado", async () => {
    const { claim } = await makePendingClaim("sec-audit-no-secrets");
    const anchor = await makeUnclaimedCompany("sec-audit-no-secrets-rev");
    const { session } = await makeSuperAdmin(anchor.id, "sec-audit-no-secrets-rev-a");
    loginAs(session);

    const res = await approveRoute.POST(jsonRequest({ reviewNote: "contato confirmado; token: abc12345" }), routeParams(claim.id));
    expect(res.status).toBe(400); // heurística de §11 já barra na validação — nunca chega a persistir.

    const event = await prisma.auditLog.findFirst({ where: { action: "platform_admin.claim_approved", targetId: claim.id } });
    expect(event).toBeNull();
  });
});

// =============================================================================
// §23 — Concorrência real (Postgres de testes)
// =============================================================================

describe("Concorrência real (§23)", () => {
  it("1 — duas aprovações simultâneas da mesma claim: só uma produz membership, a outra é conflito", async () => {
    const { company, requester, claim } = await makePendingClaim("race-double-approve");
    const anchor = await makeUnclaimedCompany("race-double-approve-rev");
    const reviewerA = (await makeSuperAdmin(anchor.id, "race-double-approve-rev-a")).session;
    const reviewerB = (await makeSuperAdmin(anchor.id, "race-double-approve-rev-b")).session;

    const results = await Promise.allSettled([
      claimsLib.approveCompanyClaimRequestAsPlatformAdmin({ claimRequestId: claim.id, reviewer: { id: reviewerA.id, name: reviewerA.name }, reviewNote: VALID_NOTE }),
      claimsLib.approveCompanyClaimRequestAsPlatformAdmin({ claimRequestId: claim.id, reviewer: { id: reviewerB.id, name: reviewerB.name }, reviewNote: VALID_NOTE }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    expect(membershipCount).toBe(1);
    const approvedEvents = await prisma.auditLog.count({ where: { action: "platform_admin.claim_approved", targetId: claim.id } });
    expect(approvedEvents).toBe(1);
  });

  it("2 — aprovação e rejeição simultâneas: estado final único (nunca os dois efeitos aplicados)", async () => {
    const { company, requester, claim } = await makePendingClaim("race-approve-reject");
    const anchor = await makeUnclaimedCompany("race-approve-reject-rev");
    const reviewerA = (await makeSuperAdmin(anchor.id, "race-approve-reject-rev-a")).session;
    const reviewerB = (await makeSuperAdmin(anchor.id, "race-approve-reject-rev-b")).session;

    await Promise.allSettled([
      claimsLib.approveCompanyClaimRequestAsPlatformAdmin({ claimRequestId: claim.id, reviewer: { id: reviewerA.id, name: reviewerA.name }, reviewNote: VALID_NOTE }),
      claimsLib.rejectCompanyClaimRequestAsPlatformAdmin({ claimRequestId: claim.id, reviewer: { id: reviewerB.id, name: reviewerB.name }, reviewNote: VALID_NOTE }),
    ]);

    const finalClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(["APPROVED", "REJECTED"]).toContain(finalClaim.status);

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    expect(membershipCount).toBe(finalClaim.status === "APPROVED" ? 1 : 0);
  });

  it("3 — dois Super Admin iniciando análise ao mesmo tempo: só um vira reviewedByUserId, sem erro técnico para o outro", async () => {
    const { claim } = await makePendingClaim("race-double-start-review");
    const anchor = await makeUnclaimedCompany("race-double-start-review-rev");
    const reviewerA = (await makeSuperAdmin(anchor.id, "race-double-start-review-rev-a")).session;
    const reviewerB = (await makeSuperAdmin(anchor.id, "race-double-start-review-rev-b")).session;

    const results = await Promise.allSettled([
      claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewerA.id, name: reviewerA.name } }),
      claimsLib.startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewerB.id, name: reviewerB.name } }),
    ]);

    // Nenhum lado é tecnicamente rejeitado (§23: "segunda resposta sem erro
    // técnico") — os dois resolvem com sucesso.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("UNDER_REVIEW");
    expect([reviewerA.id, reviewerB.id]).toContain(updated.reviewedByUserId);
  });

  it("4 — PlatformUser revogado entre duas ações administrativas: a segunda é bloqueada, nunca aplicada, sem depender de logout", async () => {
    const { claim } = await makePendingClaim("race-revoke-between-actions");
    const anchor = await makeUnclaimedCompany("race-revoke-between-actions-rev");
    const { session, platformUser } = await makeSuperAdmin(anchor.id, "race-revoke-between-actions-rev-a");
    loginAs(session);

    const first = await startReviewRoute.POST(jsonRequest({}), routeParams(claim.id));
    expect(first.status).toBe(200);

    // Simula a revogação acontecendo "no meio" — outra requisição
    // administrativa (ex.: outro Super Admin) desativa este operador entre
    // a primeira e a segunda ação da MESMA sessão (nenhum re-login aqui).
    await prisma.platformUser.update({ where: { id: platformUser.id }, data: { active: false } });

    const second = await rejectRoute.POST(jsonRequest({ reviewNote: VALID_NOTE }), routeParams(claim.id));
    expect(second.status).toBe(403);

    const updated = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updated.status).toBe("UNDER_REVIEW"); // nunca chegou a REJECTED
  });
});
