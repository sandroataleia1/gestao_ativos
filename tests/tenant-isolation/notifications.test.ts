import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestProvider,
  createTestUser,
  createTestUserWithMembership,
  createProviderUser,
  linkProviderToCompany,
  createTestPlatformUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { createNotification } from "@/lib/notifications";
import {
  listCompanyNotificationsForBell,
  countCompanyUnreadNotifications,
  listSstNotificationsForBell,
  countSstUnreadNotifications,
  listPlatformNotificationsForBell,
  countPlatformUnreadNotifications,
} from "@/lib/notifications-listing";
import { markNotificationRead, markAllNotificationsRead, dismissNotification } from "@/lib/notifications-receipts";
import { companyNotificationScope, sstNotificationScope, platformNotificationScope } from "@/lib/notifications-scope";
import { requestAccessToCompany } from "@/lib/sst-company-provisioning";
import { updateProviderLinkStatus } from "@/lib/sst-providers";
import { createOrReuseClaimRequest, approveCompanyClaimRequest, rejectCompanyClaimRequest } from "@/lib/company-claim-request";
import { resolveClaimDecision } from "@/lib/company-claim";
import { NotFoundError } from "@/lib/api-errors";

// Sprint SST 1.4E — Centro de notificações compartilhado. Cobre invariantes
// do modelo, visibilidade por portal/papel, eventos transacionais de
// domínio, leitura/dispensa individual, CSRF de uma rota representativa por
// portal, concorrência e privacidade.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let readRoute: typeof import("@/app/api/notifications/[id]/read/route");
let sstReadRoute: typeof import("@/app/api/sst/notifications/[id]/read/route");
let platformReadRoute: typeof import("@/app/api/platform-admin/notifications/[id]/read/route");

const companyIds: string[] = [];
const providerIds: string[] = [];
const platformUserIds: string[] = [];

beforeAll(async () => {
  readRoute = await import("@/app/api/notifications/[id]/read/route");
  sstReadRoute = await import("@/app/api/sst/notifications/[id]/read/route");
  platformReadRoute = await import("@/app/api/platform-admin/notifications/[id]/read/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await prisma.platformUser.deleteMany({ where: { userId: { in: platformUserIds } } });
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeCompany(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  return company;
}

async function makeProvider(label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  return provider;
}

const TRUSTED_ORIGIN = "http://localhost:3010";
function jsonRequest(body: Record<string, unknown>, headerOverrides?: Record<string, string | undefined>) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: TRUSTED_ORIGIN };
  if (headerOverrides) {
    for (const [key, value] of Object.entries(headerOverrides)) {
      if (value === undefined) delete headers[key];
      else headers[key] = value;
    }
  }
  return new NextRequest(`${TRUSTED_ORIGIN}/api/x`, { method: "POST", headers, body: JSON.stringify(body) });
}
function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// =============================================================================
// Invariantes do modelo
// =============================================================================

describe("Invariantes do modelo Notification", () => {
  it("audience COMPANY exige companyId e rejeita sstProviderId", async () => {
    const company = await makeCompany("notif-inv-company");
    await expect(
      createNotification({
        audience: "COMPANY",
        type: "COMPANY_SST_ACCESS_REQUESTED",
        title: "t",
        message: "m",
        dedupeKey: `test:${company.id}`,
      }),
    ).rejects.toThrow(/companyId/);

    const provider = await makeProvider("notif-inv-company-2");
    await expect(
      createNotification({
        audience: "COMPANY",
        companyId: company.id,
        sstProviderId: provider.id,
        type: "COMPANY_SST_ACCESS_REQUESTED",
        title: "t",
        message: "m",
        dedupeKey: `test:${company.id}:2`,
      }),
    ).rejects.toThrow(/nunca aceita sstProviderId/);
  });

  it("audience SST_PROVIDER exige sstProviderId e rejeita companyId", async () => {
    const provider = await makeProvider("notif-inv-provider");
    await expect(
      createNotification({
        audience: "SST_PROVIDER",
        type: "SST_ACCESS_APPROVED",
        title: "t",
        message: "m",
        dedupeKey: `test:${provider.id}`,
      }),
    ).rejects.toThrow(/sstProviderId/);
  });

  it("audience PLATFORM nunca aceita companyId nem sstProviderId", async () => {
    const company = await makeCompany("notif-inv-platform");
    await expect(
      createNotification({
        audience: "PLATFORM",
        companyId: company.id,
        type: "PLATFORM_COMPANY_CLAIM_REQUESTED",
        title: "t",
        message: "m",
        dedupeKey: `test:${company.id}:platform`,
      }),
    ).rejects.toThrow(/nunca aceita companyId/);
  });

  it("tipo de audiência errada é rejeitado (ex.: SST_ACCESS_APPROVED com audience COMPANY)", async () => {
    const company = await makeCompany("notif-inv-wrong-type");
    await expect(
      createNotification({
        audience: "COMPANY",
        companyId: company.id,
        type: "SST_ACCESS_APPROVED",
        title: "t",
        message: "m",
        dedupeKey: `test:${company.id}:wrong`,
      }),
    ).rejects.toThrow(/pertence à audiência/);
  });

  it("dedupeKey é obrigatória", async () => {
    const company = await makeCompany("notif-inv-nodedupe");
    await expect(
      createNotification({
        audience: "COMPANY",
        companyId: company.id,
        type: "COMPANY_SST_ACCESS_REQUESTED",
        title: "t",
        message: "m",
        dedupeKey: "",
      }),
    ).rejects.toThrow(/dedupeKey/);
  });

  it("dedupeKey é única por audiência: uma segunda chamada retorna a mesma linha (dedupeHit), nunca duplica", async () => {
    const company = await makeCompany("notif-inv-dedupe");
    const key = `test:dedupe:${company.id}`;
    const first = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Original",
      message: "m",
      dedupeKey: key,
    });
    expect(first.dedupeHit).toBe(false);

    const second = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Tentativa de sobrescrever",
      message: "m2",
      dedupeKey: key,
    });
    expect(second.dedupeHit).toBe(true);
    expect(second.notification.id).toBe(first.notification.id);
    expect(second.notification.title).toBe("Original");

    const count = await prisma.notification.count({ where: { audience: "COMPANY", dedupeKey: key } });
    expect(count).toBe(1);
  });

  it("metadata/título/mensagem contendo segredo conhecido são rejeitados", async () => {
    const company = await makeCompany("notif-inv-secret");
    await expect(
      createNotification({
        audience: "COMPANY",
        companyId: company.id,
        type: "COMPANY_SST_ACCESS_REQUESTED",
        title: "t",
        message: "senha: abc12345",
        dedupeKey: `test:secret:${company.id}`,
      }),
    ).rejects.toThrow();
  });

  it("a constraint CHECK do banco rejeita um INSERT bruto que viole a exclusividade audience/companyId/sstProviderId", async () => {
    const company = await makeCompany("notif-inv-rawsql");
    await expect(
      prisma.$executeRaw`INSERT INTO "Notification" (id, audience, "companyId", "sstProviderId", type, severity, title, message, "dedupeKey", "createdAt")
        VALUES (${"raw-" + company.id}, 'COMPANY'::"NotificationAudience", ${company.id}, ${company.id}, 'COMPANY_SST_ACCESS_REQUESTED'::"NotificationType", 'INFO'::"NotificationSeverity", 't', 'm', ${"raw-key-" + company.id}, now())`,
    ).rejects.toThrow();
  });

  it("NotificationReceipt é único por (notificationId, userId)", async () => {
    const company = await makeCompany("notif-inv-receipt");
    const user = await createTestUserWithMembership(company.id, "notif-inv-receipt-u");
    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:receipt:${company.id}`,
    });
    await prisma.notificationReceipt.create({ data: { notificationId: notification.id, userId: user.id, readAt: new Date() } });
    await expect(
      prisma.notificationReceipt.create({ data: { notificationId: notification.id, userId: user.id } }),
    ).rejects.toThrow();
  });
});

// =============================================================================
// Visibilidade — Portal Empresa
// =============================================================================

describe("Visibilidade — Portal Empresa", () => {
  it("usuário da Company ativa, com SST_PROVIDER_MANAGE, visualiza a notificação; sem a permissão, não visualiza", async () => {
    const company = await makeCompany("notif-vis-company");
    const admin = await createTestUserWithMembership(company.id, "notif-vis-company-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const plain = await createTestUserWithMembership(company.id, "notif-vis-company-plain");

    await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Nova solicitação",
      message: "m",
      dedupeKey: `test:vis:${company.id}`,
    });

    const withPermission = await listCompanyNotificationsForBell({ userId: admin.id, companyId: company.id, hasManagePermission: true });
    expect(withPermission.some((n) => n.title === "Nova solicitação")).toBe(true);

    const withoutPermission = await listCompanyNotificationsForBell({ userId: plain.id, companyId: company.id, hasManagePermission: false });
    expect(withoutPermission).toHaveLength(0);
  });

  it("usuário de outra Company nunca visualiza a notificação (isolamento de tenant)", async () => {
    const companyA = await makeCompany("notif-vis-tenant-a");
    const companyB = await makeCompany("notif-vis-tenant-b");
    const userB = await createTestUserWithMembership(companyB.id, "notif-vis-tenant-b-u");
    await assignSystemRole(userB.id, companyB.id, "ADMIN");

    await createNotification({
      audience: "COMPANY",
      companyId: companyA.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Só da empresa A",
      message: "m",
      dedupeKey: `test:vis:${companyA.id}:tenant`,
    });

    const items = await listCompanyNotificationsForBell({ userId: userB.id, companyId: companyB.id, hasManagePermission: true });
    expect(items.some((n) => n.title === "Só da empresa A")).toBe(false);
  });
});

// =============================================================================
// Visibilidade — Portal Consultoria SST
// =============================================================================

describe("Visibilidade — Portal Consultoria SST", () => {
  it("provider correto visualiza; outro provider nunca visualiza", async () => {
    const providerA = await makeProvider("notif-vis-sst-a");
    const providerB = await makeProvider("notif-vis-sst-b");

    await createNotification({
      audience: "SST_PROVIDER",
      sstProviderId: providerA.id,
      type: "SST_ACCESS_APPROVED",
      title: "Acesso liberado A",
      message: "m",
      dedupeKey: `test:vis-sst:${providerA.id}`,
    });

    const userA = await (async () => {
      const anchor = await makeCompany("notif-vis-sst-anchor-a");
      return createTestUser(anchor.id, "notif-vis-sst-user-a");
    })();
    await createProviderUser({ providerId: providerA.id, userId: userA.id, role: "OWNER" });
    const itemsA = await listSstNotificationsForBell({ userId: userA.id, sstProviderId: providerA.id, role: "OWNER" });
    expect(itemsA.some((n) => n.title === "Acesso liberado A")).toBe(true);

    const itemsB = await listSstNotificationsForBell({ userId: userA.id, sstProviderId: providerB.id, role: "OWNER" });
    expect(itemsB.some((n) => n.title === "Acesso liberado A")).toBe(false);
  });

  it("VIEWER nunca visualiza SST_ACCESS_REJECTED nem SST_ACCESS_LEVEL_CHANGED", async () => {
    const provider = await makeProvider("notif-vis-sst-viewer");
    await createNotification({
      audience: "SST_PROVIDER",
      sstProviderId: provider.id,
      type: "SST_ACCESS_REJECTED",
      title: "Rejeitado",
      message: "m",
      dedupeKey: `test:vis-sst-viewer:${provider.id}`,
    });

    const items = await listSstNotificationsForBell({ userId: "irrelevant", sstProviderId: provider.id, role: "VIEWER" });
    expect(items.some((n) => n.title === "Rejeitado")).toBe(false);
  });
});

// =============================================================================
// Visibilidade — Portal Super Admin
// =============================================================================

describe("Visibilidade — Portal Super Admin", () => {
  it("visível globalmente a qualquer PlatformUser consultando (não depende de Company/provider)", async () => {
    const company = await makeCompany("notif-vis-platform");
    await createNotification({
      audience: "PLATFORM",
      type: "PLATFORM_COMPANY_CLAIM_REQUESTED",
      title: "Nova reivindicação de teste",
      message: "m",
      entityType: "CompanyClaimRequest",
      entityId: "fake-claim-id",
      dedupeKey: `test:vis-platform:${company.id}`,
    });

    const items = await listPlatformNotificationsForBell({ userId: "any-user-id" });
    expect(items.some((n) => n.title === "Nova reivindicação de teste")).toBe(true);
  });
});

// =============================================================================
// Eventos de vínculo SST (transacionais)
// =============================================================================

describe("Eventos de vínculo SST", () => {
  it("requestAccessToCompany cria COMPANY_SST_ACCESS_REQUESTED quando a empresa já tem administrador", async () => {
    const company = await makeCompany("notif-evt-request");
    const cnpj = await import("@/lib/cnpj").then((m) => m.withValidCheckDigits(`${Date.now()}`.slice(-12).padStart(12, "0")));
    await prisma.company.update({ where: { id: company.id }, data: { document: cnpj, documentType: "CNPJ", documentNormalized: cnpj } });
    const admin = await createTestUserWithMembership(company.id, "notif-evt-request-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");

    const provider = await makeProvider("notif-evt-request-provider");
    const result = await requestAccessToCompany(provider.id, { id: admin.id, name: admin.name }, cnpj);
    expect(result.status).toBe("AUTHORIZATION_REQUESTED");

    const notification = await prisma.notification.findFirst({
      where: { audience: "COMPANY", companyId: company.id, type: "COMPANY_SST_ACCESS_REQUESTED" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.resolvedAt).toBeNull();
  });

  it("requestAccessToCompany NUNCA cria notificação empresarial se a Company não tem administrador ativo", async () => {
    const company = await makeCompany("notif-evt-request-noadmin");
    const cnpj = await import("@/lib/cnpj").then((m) => m.withValidCheckDigits(`${Date.now() + 1}`.slice(-12).padStart(12, "0")));
    await prisma.company.update({ where: { id: company.id }, data: { document: cnpj, documentType: "CNPJ", documentNormalized: cnpj } });

    const provider = await makeProvider("notif-evt-request-noadmin-provider");
    const requesterAnchor = await makeCompany("notif-evt-request-noadmin-anchor");
    const requesterUser = await createTestUser(requesterAnchor.id, "notif-evt-request-noadmin-u");
    await createProviderUser({ providerId: provider.id, userId: requesterUser.id, role: "OWNER" });

    await requestAccessToCompany(provider.id, { id: requesterUser.id, name: requesterUser.name }, cnpj);

    const notification = await prisma.notification.findFirst({
      where: { audience: "COMPANY", companyId: company.id, type: "COMPANY_SST_ACCESS_REQUESTED" },
    });
    expect(notification).toBeNull();
  });

  it("aprovação (PENDING -> ACTIVE) resolve a empresarial e cria SST_ACCESS_APPROVED", async () => {
    const company = await makeCompany("notif-evt-approve");
    const admin = await createTestUserWithMembership(company.id, "notif-evt-approve-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const provider = await makeProvider("notif-evt-approve-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING", accessLevel: "OPERATION" });
    await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      entityType: "SstProviderCompany",
      entityId: link.id,
      dedupeKey: `company:sst-access-request:${link.id}`,
    });

    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "ACTIVE", accessLevel: "OPERATION" });

    const companyNotif = await prisma.notification.findFirst({ where: { audience: "COMPANY", dedupeKey: `company:sst-access-request:${link.id}` } });
    expect(companyNotif?.resolvedAt).not.toBeNull();

    const resolvedNotif = await prisma.notification.findFirst({ where: { audience: "COMPANY", type: "COMPANY_SST_ACCESS_REQUEST_RESOLVED", entityId: link.id } });
    expect(resolvedNotif).not.toBeNull();

    const providerNotif = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_APPROVED" } });
    expect(providerNotif).not.toBeNull();
  });

  it("rejeição resolve a empresarial e cria SST_ACCESS_REJECTED", async () => {
    const company = await makeCompany("notif-evt-reject");
    const admin = await createTestUserWithMembership(company.id, "notif-evt-reject-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const provider = await makeProvider("notif-evt-reject-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING", accessLevel: "OPERATION" });

    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "REJECTED" });

    const providerNotif = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_REJECTED" } });
    expect(providerNotif).not.toBeNull();
  });

  it("suspensão e revogação criam suas notificações correspondentes", async () => {
    const company = await makeCompany("notif-evt-suspend-revoke");
    const admin = await createTestUserWithMembership(company.id, "notif-evt-suspend-revoke-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const provider = await makeProvider("notif-evt-suspend-revoke-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });

    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "SUSPENDED" });
    const suspended = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_SUSPENDED" } });
    expect(suspended).not.toBeNull();

    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "REVOKED" });
    const revoked = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_REVOKED" } });
    expect(revoked).not.toBeNull();
  });

  it("troca de nível (ACTIVE -> ACTIVE com accessLevel diferente) cria SST_ACCESS_LEVEL_CHANGED com nível anterior/novo", async () => {
    const company = await makeCompany("notif-evt-level");
    const admin = await createTestUserWithMembership(company.id, "notif-evt-level-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const provider = await makeProvider("notif-evt-level-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });

    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "ACTIVE", accessLevel: "ADMINISTRATION" });

    const notif = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_LEVEL_CHANGED" } });
    expect(notif).not.toBeNull();
    const metadata = notif?.metadata as { previousAccessLevel?: string; newAccessLevel?: string };
    expect(metadata.previousAccessLevel).toBe("OPERATION");
    expect(metadata.newAccessLevel).toBe("ADMINISTRATION");
  });

  it("ACTIVE -> ACTIVE sem mudar o nível é rejeitado (nunca um re-aprovar silencioso)", async () => {
    const company = await makeCompany("notif-evt-level-noop");
    const admin = await createTestUserWithMembership(company.id, "notif-evt-level-noop-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const provider = await makeProvider("notif-evt-level-noop-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });

    await expect(
      updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "ACTIVE", accessLevel: "OPERATION" }),
    ).rejects.toThrow();
  });
});

// =============================================================================
// Eventos de claim (reivindicação/disputa/continuidade)
// =============================================================================

describe("Eventos de claim", () => {
  async function makeUnclaimedCompany(label: string) {
    const company = await makeCompany(label);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
    return company;
  }

  it("nova claim cria PLATFORM_COMPANY_CLAIM_REQUESTED", async () => {
    const company = await makeUnclaimedCompany("notif-evt-claim-requested");
    const requesterAnchor = await makeCompany("notif-evt-claim-requested-anchor");
    const requester = await createTestUser(requesterAnchor.id, "notif-evt-claim-requested-u");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });

    const notif = await prisma.notification.findFirst({
      where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_REQUESTED", entityType: "CompanyClaimRequest", entityId: claim.id },
    });
    expect(notif).not.toBeNull();
    expect(notif?.resolvedAt).toBeNull();
  });

  it("claim sobre pré-cadastro (EXISTING_PRE_REGISTRATION) avisa a consultoria provisória (SST_COMPANY_CLAIM_STARTED) sem revelar o solicitante", async () => {
    const company = await makeUnclaimedCompany("notif-evt-claim-started");
    const provider = await makeProvider("notif-evt-claim-started-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION" });
    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { authorizationBasis: "PROVIDER_PRE_REGISTRATION" } });

    const requesterAnchor = await makeCompany("notif-evt-claim-started-anchor");
    const requester = await createTestUser(requesterAnchor.id, "notif-evt-claim-started-u");

    await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "EXISTING_PRE_REGISTRATION",
    });

    const notif = await prisma.notification.findFirst({
      where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_COMPANY_CLAIM_STARTED" },
    });
    expect(notif).not.toBeNull();
    expect(notif?.message).not.toContain(requester.name);
    expect(notif?.message).not.toContain(requester.email);
    expect(JSON.stringify(notif?.metadata ?? {})).not.toContain(requester.id);
  });

  it("segundo solicitante ativo (DISPUTED) cria PLATFORM_COMPANY_CLAIM_DISPUTED", async () => {
    const company = await makeUnclaimedCompany("notif-evt-disputed");
    const anchorA = await makeCompany("notif-evt-disputed-anchor-a");
    const anchorB = await makeCompany("notif-evt-disputed-anchor-b");
    const requesterA = await createTestUser(anchorA.id, "notif-evt-disputed-a");
    const requesterB = await createTestUser(anchorB.id, "notif-evt-disputed-b");

    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterA.id, name: requesterA.name }, origin: "SELF_REGISTRATION" });
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterB.id, name: requesterB.name }, origin: "SELF_REGISTRATION" });

    const notif = await prisma.notification.findFirst({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_DISPUTED", entityId: company.id } });
    expect(notif).not.toBeNull();
  });

  it("aprovação de uma claim resolve a notificação de plataforma da claim e a de disputa", async () => {
    const company = await makeUnclaimedCompany("notif-evt-claim-approve");
    const anchorA = await makeCompany("notif-evt-claim-approve-anchor-a");
    const anchorB = await makeCompany("notif-evt-claim-approve-anchor-b");
    const requesterA = await createTestUser(anchorA.id, "notif-evt-claim-approve-a");
    const requesterB = await createTestUser(anchorB.id, "notif-evt-claim-approve-b");

    const { claim: claimA } = await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterA.id, name: requesterA.name }, origin: "SELF_REGISTRATION" });
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterB.id, name: requesterB.name }, origin: "SELF_REGISTRATION" });

    const reviewer = await createTestUser(anchorA.id, "notif-evt-claim-approve-reviewer");
    await approveCompanyClaimRequest({ claimRequestId: claimA.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const claimNotif = await prisma.notification.findFirst({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_REQUESTED", entityId: claimA.id } });
    expect(claimNotif?.resolvedAt).not.toBeNull();

    const disputeNotif = await prisma.notification.findFirst({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_DISPUTED", entityId: company.id } });
    expect(disputeNotif?.resolvedAt).not.toBeNull();
  });

  it("rejeição de uma claim resolve sua notificação de plataforma", async () => {
    const company = await makeUnclaimedCompany("notif-evt-claim-reject");
    const anchor = await makeCompany("notif-evt-claim-reject-anchor");
    const requester = await createTestUser(anchor.id, "notif-evt-claim-reject-u");
    const reviewer = await createTestUser(anchor.id, "notif-evt-claim-reject-reviewer");

    const { claim } = await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requester.id, name: requester.name }, origin: "SELF_REGISTRATION" });
    await rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const notif = await prisma.notification.findFirst({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_REQUESTED", entityId: claim.id } });
    expect(notif?.resolvedAt).not.toBeNull();
  });

  it("CONTINUE cria SST_AUTHORIZATION_CONFIRMED e resolve SST_COMPANY_CLAIM_STARTED", async () => {
    const company = await makeCompany("notif-evt-continue");
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const admin = await createTestUserWithMembership(company.id, "notif-evt-continue-admin");
    await createTestMembership({ userId: admin.id, companyId: company.id, status: "ACTIVE" }).catch(() => {});
    await prisma.companyClaimRequest.create({
      data: { companyId: company.id, requesterUserId: admin.id, status: "APPROVED", origin: "EXISTING_PRE_REGISTRATION", reviewedAt: new Date() },
    });

    const provider = await makeProvider("notif-evt-continue-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION" });
    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { authorizationBasis: "PROVIDER_PRE_REGISTRATION" } });
    await createNotification({
      audience: "SST_PROVIDER",
      sstProviderId: provider.id,
      type: "SST_COMPANY_CLAIM_STARTED",
      title: "t",
      message: "m",
      entityType: "SstProviderCompany",
      entityId: link.id,
      dedupeKey: `provider:claim-started:${company.id}:${link.id}:v1`,
    });

    await resolveClaimDecision(company.id, { id: admin.id, name: admin.name }, link.id, "CONTINUE");

    const confirmed = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_AUTHORIZATION_CONFIRMED" } });
    expect(confirmed).not.toBeNull();
    const started = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_COMPANY_CLAIM_STARTED" } });
    expect(started?.resolvedAt).not.toBeNull();
  });

  it("BLOCK cria SST_AUTHORIZATION_BLOCKED e resolve SST_COMPANY_CLAIM_STARTED; vínculo nunca continua ACTIVE", async () => {
    const company = await makeCompany("notif-evt-block");
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const admin = await createTestUserWithMembership(company.id, "notif-evt-block-admin");
    await prisma.companyClaimRequest.create({
      data: { companyId: company.id, requesterUserId: admin.id, status: "APPROVED", origin: "EXISTING_PRE_REGISTRATION", reviewedAt: new Date() },
    });

    const provider = await makeProvider("notif-evt-block-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION" });
    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { authorizationBasis: "PROVIDER_PRE_REGISTRATION" } });

    await resolveClaimDecision(company.id, { id: admin.id, name: admin.name }, link.id, "BLOCK");

    const blocked = await prisma.notification.findFirst({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_AUTHORIZATION_BLOCKED" } });
    expect(blocked).not.toBeNull();

    const updatedLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("REVOKED");
  });
});

// =============================================================================
// Leitura e dispensa
// =============================================================================

describe("Leitura e dispensa", () => {
  it("markNotificationRead cria receipt e é idempotente; outro usuário permanece não lida", async () => {
    const company = await makeCompany("notif-read-basic");
    const admin = await createTestUserWithMembership(company.id, "notif-read-basic-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const otherUser = await createTestUserWithMembership(company.id, "notif-read-basic-other");
    await assignSystemRole(otherUser.id, company.id, "ADMIN");

    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:read:${company.id}`,
    });

    const scope = companyNotificationScope(company.id, true);
    await markNotificationRead(admin.id, notification.id, scope);
    await markNotificationRead(admin.id, notification.id, scope); // idempotente

    const receiptCount = await prisma.notificationReceipt.count({ where: { notificationId: notification.id, userId: admin.id } });
    expect(receiptCount).toBe(1);

    const otherReceipt = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: notification.id, userId: otherUser.id } } });
    expect(otherReceipt).toBeNull();
  });

  it("notificação de outro escopo (outra Company) retorna NotFoundError ao tentar marcar como lida", async () => {
    const companyA = await makeCompany("notif-read-cross-a");
    const companyB = await makeCompany("notif-read-cross-b");
    const userB = await createTestUserWithMembership(companyB.id, "notif-read-cross-b-u");
    await assignSystemRole(userB.id, companyB.id, "ADMIN");

    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: companyA.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:read-cross:${companyA.id}`,
    });

    await expect(markNotificationRead(userB.id, notification.id, companyNotificationScope(companyB.id, true))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("markAllNotificationsRead só afeta o escopo atual (nunca outra Company/provider)", async () => {
    const companyA = await makeCompany("notif-readall-a");
    const companyB = await makeCompany("notif-readall-b");
    const admin = await createTestUserWithMembership(companyA.id, "notif-readall-admin");
    await assignSystemRole(admin.id, companyA.id, "ADMIN");

    const { notification: notifA } = await createNotification({
      audience: "COMPANY",
      companyId: companyA.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "A",
      message: "m",
      dedupeKey: `test:readall:${companyA.id}`,
    });
    const { notification: notifB } = await createNotification({
      audience: "COMPANY",
      companyId: companyB.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "B",
      message: "m",
      dedupeKey: `test:readall:${companyB.id}`,
    });

    const count = await markAllNotificationsRead(admin.id, companyNotificationScope(companyA.id, true));
    expect(count).toBe(1);

    const receiptA = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: notifA.id, userId: admin.id } } });
    expect(receiptA?.readAt).not.toBeNull();
    const receiptB = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: notifB.id, userId: admin.id } } });
    expect(receiptB).toBeNull();
  });

  it("dismiss nunca resolve globalmente nem afeta outro usuário", async () => {
    const company = await makeCompany("notif-dismiss");
    const admin = await createTestUserWithMembership(company.id, "notif-dismiss-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const otherUser = await createTestUserWithMembership(company.id, "notif-dismiss-other");
    await assignSystemRole(otherUser.id, company.id, "ADMIN");

    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:dismiss:${company.id}`,
    });

    await dismissNotification(admin.id, notification.id, companyNotificationScope(company.id, true));

    const refreshed = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(refreshed.resolvedAt).toBeNull(); // nunca resolve globalmente

    const otherReceipt = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: notification.id, userId: otherUser.id } } });
    expect(otherReceipt).toBeNull(); // nunca afeta outro usuário
  });
});

// =============================================================================
// APIs e CSRF (uma rota representativa por portal)
// =============================================================================

describe("APIs e CSRF", () => {
  it("Portal Empresa: Origin externo é bloqueado (403); Origin oficial com sessão válida funciona", async () => {
    const company = await makeCompany("notif-api-company-csrf");
    const admin = await createTestUserWithMembership(company.id, "notif-api-company-csrf-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:api-csrf:${company.id}`,
    });
    loginAs(toSessionUser(admin));

    const blocked = await readRoute.POST(jsonRequest({}, { origin: "https://evil.example" }), routeParams(notification.id));
    expect(blocked.status).toBe(403);

    const ok = await readRoute.POST(jsonRequest({}), routeParams(notification.id));
    expect(ok.status).toBe(200);
  });

  it("Portal Consultoria: sessão ausente retorna 401; notificação de outro provider retorna 404", async () => {
    const providerA = await makeProvider("notif-api-sst-csrf-a");
    const providerB = await makeProvider("notif-api-sst-csrf-b");
    const anchor = await makeCompany("notif-api-sst-csrf-anchor");
    const userA = await createTestUser(anchor.id, "notif-api-sst-csrf-u");
    await createProviderUser({ providerId: providerA.id, userId: userA.id, role: "OWNER" });

    const { notification: notifB } = await createNotification({
      audience: "SST_PROVIDER",
      sstProviderId: providerB.id,
      type: "SST_ACCESS_APPROVED",
      title: "t",
      message: "m",
      dedupeKey: `test:api-sst-csrf:${providerB.id}`,
    });

    loginAs(null);
    const noSession = await sstReadRoute.POST(jsonRequest({}), routeParams(notifB.id));
    expect(noSession.status).toBe(401);

    loginAs(toSessionUser(userA));
    const crossProvider = await sstReadRoute.POST(jsonRequest({}), routeParams(notifB.id));
    expect(crossProvider.status).toBe(404);
  });

  it("Portal Super Admin: usuário sem PlatformUser recebe 403", async () => {
    const anchor = await makeCompany("notif-api-platform-csrf");
    const plainUser = await createTestUser(anchor.id, "notif-api-platform-csrf-u");
    const { notification } = await createNotification({
      audience: "PLATFORM",
      type: "PLATFORM_COMPANY_CLAIM_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:api-platform-csrf:${anchor.id}`,
    });

    loginAs(toSessionUser(plainUser));
    const forbidden = await platformReadRoute.POST(jsonRequest({}), routeParams(notification.id));
    expect(forbidden.status).toBe(403);

    const platformAdmin = await createTestUser(anchor.id, "notif-api-platform-csrf-admin");
    platformUserIds.push(platformAdmin.id);
    await createTestPlatformUser({ userId: platformAdmin.id, active: true });
    loginAs(toSessionUser(platformAdmin));
    const ok = await platformReadRoute.POST(jsonRequest({}), routeParams(notification.id));
    expect(ok.status).toBe(200);
  });
});

// =============================================================================
// Concorrência
// =============================================================================

describe("Concorrência", () => {
  it("duas criações concorrentes com a mesma dedupeKey resultam em uma única notificação", async () => {
    const company = await makeCompany("notif-race-create");
    const key = `test:race:${company.id}`;

    const results = await Promise.allSettled([
      createNotification({ audience: "COMPANY", companyId: company.id, type: "COMPANY_SST_ACCESS_REQUESTED", title: "t", message: "m", dedupeKey: key }),
      createNotification({ audience: "COMPANY", companyId: company.id, type: "COMPANY_SST_ACCESS_REQUESTED", title: "t", message: "m", dedupeKey: key }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const count = await prisma.notification.count({ where: { audience: "COMPANY", dedupeKey: key } });
    expect(count).toBe(1);
  });

  it("duas leituras simultâneas da mesma notificação criam um único receipt", async () => {
    const company = await makeCompany("notif-race-read");
    const admin = await createTestUserWithMembership(company.id, "notif-race-read-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const { notification } = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "t",
      message: "m",
      dedupeKey: `test:race-read:${company.id}`,
    });

    const scope = companyNotificationScope(company.id, true);
    await Promise.allSettled([markNotificationRead(admin.id, notification.id, scope), markNotificationRead(admin.id, notification.id, scope)]);

    const count = await prisma.notificationReceipt.count({ where: { notificationId: notification.id, userId: admin.id } });
    expect(count).toBe(1);
  });
});

// =============================================================================
// Privacidade
// =============================================================================

describe("Privacidade", () => {
  it("nenhuma notificação de vínculo SST inclui o CNPJ completo da empresa", async () => {
    const company = await makeCompany("notif-privacy-cnpj");
    const admin = await createTestUserWithMembership(company.id, "notif-privacy-cnpj-admin");
    await assignSystemRole(admin.id, company.id, "ADMIN");
    const cnpj = await import("@/lib/cnpj").then((m) => m.withValidCheckDigits(`${Date.now() + 2}`.slice(-12).padStart(12, "0")));
    await prisma.company.update({ where: { id: company.id }, data: { document: cnpj, documentType: "CNPJ", documentNormalized: cnpj } });

    const provider = await makeProvider("notif-privacy-cnpj-provider");
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING", accessLevel: "OPERATION" });
    await updateProviderLinkStatus(company.id, { id: admin.id, name: admin.name }, link.id, { status: "ACTIVE" });

    const notif = await prisma.notification.findFirstOrThrow({ where: { audience: "SST_PROVIDER", sstProviderId: provider.id, type: "SST_ACCESS_APPROVED" } });
    expect(notif.message).not.toContain(cnpj);
    expect(JSON.stringify(notif.metadata ?? {})).not.toContain(cnpj);
  });

  it("token/senha/cookie nunca são persistidos em metadata (guardado por assertNoSecrets)", async () => {
    const company = await makeCompany("notif-privacy-secret");
    await expect(
      createNotification({
        audience: "COMPANY",
        companyId: company.id,
        type: "COMPANY_SST_ACCESS_REQUESTED",
        title: "t",
        message: "m",
        dedupeKey: `test:privacy-secret:${company.id}`,
        metadata: { token: "abc123" },
      }),
    ).rejects.toThrow();
  });
});
