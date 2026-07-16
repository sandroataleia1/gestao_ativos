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
import { createNotification, resolveNotificationsForEntity } from "@/lib/notifications";
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
import {
  createOrReuseClaimRequest,
  approveCompanyClaimRequest,
  rejectCompanyClaimRequest,
  cancelCompanyClaimRequest,
} from "@/lib/company-claim-request";
import { startCompanyClaimReview } from "@/lib/platform-admin-claims";
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
// Sprint SST 1.4E.1 — reabertura de claim gera um NOVO ciclo institucional
// =============================================================================
//
// Bug corrigido: `notifyPlatformClaimRequested` reutilizava a dedupeKey
// `platform:claim-requested:{claimRequestId}` (sem versão) — ao reabrir uma
// claim REJECTED/CANCELLED/EXPIRED (mesma linha, mesmo id, ver
// `lib/company-claim-request.ts:createOrReuseClaimRequest`), a chamada
// encontrava a Notification antiga (já com `resolvedAt` preenchido) e a
// devolvia como está, nunca zerando `resolvedAt` — o Super Admin não via a
// claim reaberta como pendente. Corrigido incluindo `claimVersion` (=
// `claim.requestedAt.getTime()`, já computado e usado por
// `notifyProviderCompanyClaimStarted` no mesmo bloco) na dedupeKey: cada
// ciclo legítimo passa a gerar uma Notification NOVA, nunca reabre a antiga
// em-place — preserva histórico e nunca herda receipts antigos.

describe("Sprint SST 1.4E.1 — reabertura de claim gera novo ciclo institucional", () => {
  async function makeUnclaimedCompany(label: string) {
    const company = await makeCompany(label);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
    return company;
  }

  function platformClaimNotifs(claimRequestId: string) {
    return prisma.notification.findMany({
      where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_REQUESTED", entityId: claimRequestId },
      orderBy: { createdAt: "asc" },
    });
  }

  it("REJECTED -> PENDING: a claim reabre na MESMA linha, mas gera uma NOVA Notification pendente; a antiga permanece resolvida e intacta", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-rejected");
    const requester = await createTestUser(company.id, "notif-reopen-rejected-u");
    const reviewer = await createTestUser(company.id, "notif-reopen-rejected-rev");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });

    const [firstNotif] = await platformClaimNotifs(claim.id);
    expect(firstNotif.resolvedAt).toBeNull();

    await rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    const firstAfterReject = await prisma.notification.findUniqueOrThrow({ where: { id: firstNotif.id } });
    expect(firstAfterReject.resolvedAt).not.toBeNull();

    const { claim: reopened, reused } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    expect(reopened.id).toBe(claim.id); // nunca uma segunda CompanyClaimRequest — mesma linha reaberta
    expect(reopened.status).toBe("PENDING");
    expect(reused).toBe(true);

    const allNotifs = await platformClaimNotifs(claim.id);
    expect(allNotifs).toHaveLength(2); // histórico com os DOIS ciclos, nunca só 1
    const [oldNotif, newNotif] = allNotifs;
    expect(oldNotif.id).toBe(firstNotif.id);
    expect(oldNotif.resolvedAt).not.toBeNull(); // preservada, nunca reaberta em-place
    expect(newNotif.id).not.toBe(oldNotif.id);
    expect(newNotif.resolvedAt).toBeNull(); // novo ciclo, pendente
    expect(newNotif.dedupeKey).not.toBe(oldNotif.dedupeKey);
    expect(newNotif.title).toBe(oldNotif.title);
    expect(newNotif.message).toBe(oldNotif.message);

    const count = await countPlatformUnreadNotifications({ userId: "any-user-id" });
    expect(count).toBeGreaterThan(0);
    const bellItems = await listPlatformNotificationsForBell({ userId: "any-user-id" });
    expect(bellItems.some((n) => n.id === newNotif.id)).toBe(true);
  });

  it("CANCELLED -> PENDING: mesmo comportamento — nova Notification pendente, antiga preservada resolvida", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-cancelled");
    const requester = await createTestUser(company.id, "notif-reopen-cancelled-u");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    const [firstNotif] = await platformClaimNotifs(claim.id);

    await cancelCompanyClaimRequest({ claimRequestId: claim.id, actor: { id: requester.id, name: requester.name } });
    const firstAfterCancel = await prisma.notification.findUniqueOrThrow({ where: { id: firstNotif.id } });
    expect(firstAfterCancel.resolvedAt).not.toBeNull();

    const { claim: reopened } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    expect(reopened.id).toBe(claim.id);
    expect(reopened.status).toBe("PENDING");

    const allNotifs = await platformClaimNotifs(claim.id);
    expect(allNotifs).toHaveLength(2);
    expect(allNotifs[0].resolvedAt).not.toBeNull();
    expect(allNotifs[1].resolvedAt).toBeNull();
    expect(allNotifs[1].dedupeKey).not.toBe(allNotifs[0].dedupeKey);
  });

  it("EXPIRED -> PENDING: mesmo comportamento — o serviço real não possui expiração automática (§21 do spec 1.4E.1), então o status é ajustado diretamente para simular o ciclo terminal", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-expired");
    const requester = await createTestUser(company.id, "notif-reopen-expired-u");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    const [firstNotif] = await platformClaimNotifs(claim.id);

    // Nenhum job de expiração existe hoje — simula o estado terminal
    // diretamente (mesmo efeito de resolução que rejectCompanyClaimRequest/
    // cancelCompanyClaimRequest produzem sobre a Notification).
    await prisma.companyClaimRequest.update({ where: { id: claim.id }, data: { status: "EXPIRED", reviewedAt: new Date() } });
    await resolveNotificationsForEntity("CompanyClaimRequest", claim.id);
    const firstAfterExpire = await prisma.notification.findUniqueOrThrow({ where: { id: firstNotif.id } });
    expect(firstAfterExpire.resolvedAt).not.toBeNull();

    const { claim: reopened } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    expect(reopened.id).toBe(claim.id);
    expect(reopened.status).toBe("PENDING");

    const allNotifs = await platformClaimNotifs(claim.id);
    expect(allNotifs).toHaveLength(2);
    expect(allNotifs[0].resolvedAt).not.toBeNull();
    expect(allNotifs[1].resolvedAt).toBeNull();
  });

  it("retry dentro do MESMO ciclo (PENDING) não cria nova Notification nem novo ciclo", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-retry-pending");
    const requester = await createTestUser(company.id, "notif-reopen-retry-pending-u");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    const { claim: again, reused } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    expect(again.id).toBe(claim.id);
    expect(reused).toBe(true);
    expect(again.status).toBe("PENDING");

    const allNotifs = await platformClaimNotifs(claim.id);
    expect(allNotifs).toHaveLength(1);
    expect(allNotifs[0].resolvedAt).toBeNull();
  });

  it("retry dentro do MESMO ciclo (UNDER_REVIEW) não cria nova Notification nem novo ciclo", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-retry-review");
    const requester = await createTestUser(company.id, "notif-reopen-retry-review-u");
    const reviewerUser = await createTestUser(company.id, "notif-reopen-retry-review-rev");
    await createTestPlatformUser({ userId: reviewerUser.id });
    platformUserIds.push(reviewerUser.id);

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    await startCompanyClaimReview({ claimRequestId: claim.id, reviewer: { id: reviewerUser.id, name: reviewerUser.name } });

    const { claim: again, reused } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    expect(again.id).toBe(claim.id);
    expect(reused).toBe(true);
    expect(again.status).toBe("UNDER_REVIEW");

    const allNotifs = await platformClaimNotifs(claim.id);
    expect(allNotifs).toHaveLength(1);
    expect(allNotifs[0].resolvedAt).toBeNull();
  });

  it("resolução do ciclo NOVO não altera a Notification do ciclo antigo (histórico preservado)", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-resolve-new");
    const requester = await createTestUser(company.id, "notif-reopen-resolve-new-u");
    const reviewer = await createTestUser(company.id, "notif-reopen-resolve-new-rev");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    await rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });

    const beforeApprove = await platformClaimNotifs(claim.id);
    expect(beforeApprove).toHaveLength(2);
    const oldResolvedAtBefore = beforeApprove[0].resolvedAt;

    await approveCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const afterApprove = await platformClaimNotifs(claim.id);
    expect(afterApprove).toHaveLength(2); // nenhuma linha apagada
    expect(afterApprove[0].resolvedAt?.getTime()).toBe(oldResolvedAtBefore?.getTime()); // ciclo antigo inalterado
    expect(afterApprove[1].resolvedAt).not.toBeNull(); // ciclo novo agora resolvido
    // Página "Todas" consegue distinguir os dois eventos pelo createdAt.
    expect(afterApprove[1].createdAt.getTime()).toBeGreaterThan(afterApprove[0].createdAt.getTime());
  });

  it("receipts entre ciclos: leitura/dispensa do ciclo antigo nunca afetam a Notification do ciclo novo", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-receipts");
    const requester = await createTestUser(company.id, "notif-reopen-receipts-u");
    const reviewer = await createTestUser(company.id, "notif-reopen-receipts-rev");
    const superAdminA = await createTestUser(company.id, "notif-reopen-receipts-admin-a");
    const superAdminB = await createTestUser(company.id, "notif-reopen-receipts-admin-b");
    await createTestPlatformUser({ userId: superAdminA.id });
    await createTestPlatformUser({ userId: superAdminB.id });
    platformUserIds.push(superAdminA.id, superAdminB.id);

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    const [firstNotif] = await platformClaimNotifs(claim.id);

    // A lê; B dispensa — ambos sobre o ciclo ANTIGO.
    await markNotificationRead(superAdminA.id, firstNotif.id, platformNotificationScope());
    await dismissNotification(superAdminB.id, firstNotif.id, platformNotificationScope());

    await rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });

    const [, newNotif] = await platformClaimNotifs(claim.id);

    // Receipts do ciclo antigo permanecem intactos.
    const oldReceiptA = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: firstNotif.id, userId: superAdminA.id } } });
    expect(oldReceiptA?.readAt).not.toBeNull();
    const oldReceiptB = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: firstNotif.id, userId: superAdminB.id } } });
    expect(oldReceiptB?.dismissedAt).not.toBeNull();

    // A nova Notification nunca herda receipts — nenhum registro para A/B ainda.
    const newReceiptsCount = await prisma.notificationReceipt.count({ where: { notificationId: newNotif.id } });
    expect(newReceiptsCount).toBe(0);

    // A (que leu a antiga) vê a NOVA como não lida no sino.
    const bellForA = await listPlatformNotificationsForBell({ userId: superAdminA.id });
    const newInBellForA = bellForA.find((n) => n.id === newNotif.id);
    expect(newInBellForA).toBeDefined();
    expect(newInBellForA?.isRead).toBe(false);

    // B (que dispensou a antiga) também vê a NOVA no sino — dismiss antigo não a oculta.
    const bellForB = await listPlatformNotificationsForBell({ userId: superAdminB.id });
    expect(bellForB.some((n) => n.id === newNotif.id)).toBe(true);

    // read-all do ciclo antigo (já lido/dispensado) não interfere — marcar
    // todas como lidas agora só afeta a nova, nunca reescreve a antiga.
    const markedCount = await markAllNotificationsRead(superAdminA.id, platformNotificationScope());
    expect(markedCount).toBeGreaterThan(0);
    const newReceiptAAfter = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: newNotif.id, userId: superAdminA.id } } });
    expect(newReceiptAAfter?.readAt).not.toBeNull();
    const oldReceiptAAfter = await prisma.notificationReceipt.findUnique({ where: { notificationId_userId: { notificationId: firstNotif.id, userId: superAdminA.id } } });
    expect(oldReceiptAAfter?.readAt?.getTime()).toBe(oldReceiptA?.readAt?.getTime()); // nunca reescrito
  });

  it("duas reaberturas concorrentes da mesma claim terminal geram um único ciclo novo (nenhuma membership/vínculo SST alterado, nenhuma transação abortada)", async () => {
    const company = await makeUnclaimedCompany("notif-reopen-concurrent");
    const requester = await createTestUser(company.id, "notif-reopen-concurrent-u");
    const reviewer = await createTestUser(company.id, "notif-reopen-concurrent-rev");

    const { claim } = await createOrReuseClaimRequest({
      companyId: company.id,
      requester: { id: requester.id, name: requester.name },
      origin: "SELF_REGISTRATION",
    });
    await rejectCompanyClaimRequest({ claimRequestId: claim.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const results = await Promise.allSettled([
      createOrReuseClaimRequest({ companyId: company.id, requester: { id: requester.id, name: requester.name }, origin: "SELF_REGISTRATION" }),
      createOrReuseClaimRequest({ companyId: company.id, requester: { id: requester.id, name: requester.name }, origin: "SELF_REGISTRATION" }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const finalClaim = await prisma.companyClaimRequest.findUniqueOrThrow({ where: { id: claim.id } });
    expect(finalClaim.status).toBe("PENDING");

    const allNotifs = await platformClaimNotifs(claim.id);
    // Ciclo antigo (resolvido) + exatamente UM ciclo novo (pendente) — nunca dois.
    expect(allNotifs).toHaveLength(2);
    const pendingOnes = allNotifs.filter((n) => n.resolvedAt === null);
    expect(pendingOnes).toHaveLength(1);

    const membershipCount = await prisma.companyMembership.count({ where: { companyId: company.id, userId: requester.id } });
    expect(membershipCount).toBe(0); // reabertura nunca concede acesso por si só
  });
});

// =============================================================================
// Sprint SST 1.4E.1 — idempotência transacional de createNotification
// =============================================================================

describe("Sprint SST 1.4E.1 — idempotência transacional de createNotification", () => {
  it("duas transações interativas concorrentes com a mesma dedupeKey: nenhuma é abortada, ambas permanecem utilizáveis, uma única Notification é criada", async () => {
    const company = await makeCompany("notif-tx-race");
    const key = `test:tx-race:${company.id}`;

    // Sentinela: uma tabela qualquer já usada nos testes, gravada DEPOIS de
    // createNotification, na MESMA transação — se createNotification tivesse
    // abortado a transação (P2002 não tratado), esta escrita também falharia.
    async function attempt(sentinelLabel: string) {
      return prisma.$transaction(async (tx) => {
        const result = await createNotification(
          { audience: "COMPANY", companyId: company.id, type: "COMPANY_SST_ACCESS_REQUESTED", title: "t", message: "m", dedupeKey: key },
          tx,
        );
        const sentinel = await tx.auditLog.create({
          data: {
            companyId: company.id,
            actorName: "test-sentinel",
            action: "test_sentinel.tx_race", // escrita qualquer, só para provar que a transação continua utilizável após createNotification
            targetType: "Notification",
            targetId: result.notification.id,
            metadata: { sentinelLabel },
          },
        });
        return { dedupeHit: result.dedupeHit, sentinelId: sentinel.id };
      });
    }

    const results = await Promise.allSettled([attempt("A"), attempt("B")]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const fulfilled = results as PromiseFulfilledResult<{ dedupeHit: boolean; sentinelId: string }>[];
    // Nenhuma resposta expõe P2002 (nenhuma rejeitada — já garantido pelo
    // `every fulfilled` acima; reforça a intenção do teste).
    expect(results.some((r) => r.status === "rejected")).toBe(false);

    const dedupeHits = fulfilled.map((r) => r.value.dedupeHit);
    expect(dedupeHits.filter((h) => h === false)).toHaveLength(1); // exatamente uma inseriu
    expect(dedupeHits.filter((h) => h === true)).toHaveLength(1); // a outra encontrou a existente

    // Ambas as escritas sentinela foram persistidas — prova de que NENHUMA
    // das duas transações foi abortada pela colisão de dedupe.
    const sentinelIds = fulfilled.map((r) => r.value.sentinelId);
    const sentinelRows = await prisma.auditLog.findMany({ where: { id: { in: sentinelIds } } });
    expect(sentinelRows).toHaveLength(2);

    const notifCount = await prisma.notification.count({ where: { audience: "COMPANY", dedupeKey: key } });
    expect(notifCount).toBe(1);
  });

  it("dedupe-hit nunca sobrescreve conteúdo nem remove resolvedAt (retry representa o MESMO evento, não uma edição)", async () => {
    const company = await makeCompany("notif-tx-dedupe-content");
    const key = `test:tx-dedupe-content:${company.id}`;

    const first = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Título original",
      message: "Mensagem original",
      actionKey: "COMPANY_REVIEW_SST_ACCESS",
      dedupeKey: key,
      metadata: { note: "original" },
    });
    expect(first.dedupeHit).toBe(false);

    await prisma.notification.update({ where: { id: first.notification.id }, data: { resolvedAt: new Date() } });

    const second = await createNotification({
      audience: "COMPANY",
      companyId: company.id,
      type: "COMPANY_SST_ACCESS_REQUESTED",
      title: "Título DIFERENTE (nunca deveria sobrescrever)",
      message: "Mensagem DIFERENTE (nunca deveria sobrescrever)",
      actionKey: null,
      dedupeKey: key,
      metadata: { note: "diferente" },
    });
    expect(second.dedupeHit).toBe(true);
    expect(second.notification.id).toBe(first.notification.id);
    expect(second.notification.title).toBe("Título original");
    expect(second.notification.message).toBe("Mensagem original");
    expect(second.notification.actionKey).toBe("COMPANY_REVIEW_SST_ACCESS");
    expect((second.notification.metadata as Record<string, unknown> | null)?.note).toBe("original");
    expect(second.notification.resolvedAt).not.toBeNull(); // nunca removido por um dedupe-hit
  });
});

// =============================================================================
// Sprint SST 1.4E.1 — disputa (PLATFORM_COMPANY_CLAIM_DISPUTED) — auditoria
// =============================================================================
//
// Auditoria confirmou que a disputa JÁ é versionada corretamente
// (`disputeVersion` = `Company.updatedAt` no momento exato em que
// `controlStatus` transiciona para DISPUTED, sempre um valor novo — a
// disputa só é reaberta depois de reverter para UNCLAIMED). Testes abaixo
// PROVAM esse comportamento (não presumido do código-fonte).

describe("Sprint SST 1.4E.1 — disputa não apresenta o mesmo silenciamento", () => {
  async function makeUnclaimedCompany(label: string) {
    const company = await makeCompany(label);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "UNCLAIMED" } });
    return company;
  }

  it("disputa repetida dentro do MESMO ciclo (terceiro solicitante) não duplica a Notification de disputa", async () => {
    const company = await makeUnclaimedCompany("notif-dispute-repeat");
    const requesterA = await createTestUser(company.id, "notif-dispute-repeat-a");
    const requesterB = await createTestUser(company.id, "notif-dispute-repeat-b");
    const requesterC = await createTestUser(company.id, "notif-dispute-repeat-c");

    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterA.id, name: requesterA.name }, origin: "SELF_REGISTRATION" });
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterB.id, name: requesterB.name }, origin: "SELF_REGISTRATION" });
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterC.id, name: requesterC.name }, origin: "SELF_REGISTRATION" });

    const disputes = await prisma.notification.findMany({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_DISPUTED", entityId: company.id } });
    expect(disputes).toHaveLength(1);
  });

  it("uma disputa FUTURA legítima (após a primeira ser totalmente resolvida) gera uma NOVA Notification, nunca silenciada pela resolução anterior", async () => {
    const company = await makeUnclaimedCompany("notif-dispute-future");
    const requesterA = await createTestUser(company.id, "notif-dispute-future-a");
    const requesterB = await createTestUser(company.id, "notif-dispute-future-b");
    const reviewer = await createTestUser(company.id, "notif-dispute-future-rev");

    const { claim: claimA } = await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterA.id, name: requesterA.name }, origin: "SELF_REGISTRATION" });
    const { claim: claimB } = await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterB.id, name: requesterB.name }, origin: "SELF_REGISTRATION" });

    const firstDispute = await prisma.notification.findFirstOrThrow({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_DISPUTED", entityId: company.id } });

    // Resolve a disputa rejeitando AMBAS as claims — a empresa volta a UNCLAIMED.
    await rejectCompanyClaimRequest({ claimRequestId: claimA.id, reviewer: { id: reviewer.id, name: reviewer.name } });
    await rejectCompanyClaimRequest({ claimRequestId: claimB.id, reviewer: { id: reviewer.id, name: reviewer.name } });

    const firstDisputeAfter = await prisma.notification.findUniqueOrThrow({ where: { id: firstDispute.id } });
    expect(firstDisputeAfter.resolvedAt).not.toBeNull();
    const companyAfter = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(companyAfter.controlStatus).toBe("UNCLAIMED");

    // Nova disputa legítima: dois novos solicitantes para a MESMA empresa.
    const requesterC = await createTestUser(company.id, "notif-dispute-future-c");
    const requesterD = await createTestUser(company.id, "notif-dispute-future-d");
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterC.id, name: requesterC.name }, origin: "SELF_REGISTRATION" });
    await createOrReuseClaimRequest({ companyId: company.id, requester: { id: requesterD.id, name: requesterD.name }, origin: "SELF_REGISTRATION" });

    const allDisputes = await prisma.notification.findMany({ where: { audience: "PLATFORM", type: "PLATFORM_COMPANY_CLAIM_DISPUTED", entityId: company.id }, orderBy: { createdAt: "asc" } });
    expect(allDisputes).toHaveLength(2); // histórico com os dois ciclos de disputa
    expect(allDisputes[0].resolvedAt).not.toBeNull();
    expect(allDisputes[1].resolvedAt).toBeNull();
    expect(allDisputes[1].dedupeKey).not.toBe(allDisputes[0].dedupeKey);
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
