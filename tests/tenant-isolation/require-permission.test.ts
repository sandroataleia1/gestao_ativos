import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestMembership,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { PERMISSIONS } from "@/lib/permissions";

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let authServer: typeof import("@/lib/auth-server");

const companyIds: string[] = [];

beforeAll(async () => {
  authServer = await import("@/lib/auth-server");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

describe("requirePermission() — Sprint 0.5, Parte H", () => {
  it("caso 21: UserRole sem CompanyMembership ACTIVE não concede acesso", async () => {
    // Único vínculo do usuário é uma UserRole ADMIN — sem NENHUMA
    // CompanyMembership. requireCompany() (chamado por dentro de
    // requirePermission()) já bloqueia aqui: um UserRole nunca é suficiente
    // sozinho, exatamente a garantia pedida.
    const company = await createTestCompanyWithRoles("rp-userrole-only");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "rp-userrole-only");
    await assignSystemRole(user.id, company.id, "ADMIN");
    loginAs(toSessionUser(user));

    await expect(authServer.requirePermission(PERMISSIONS.EMPLOYEE_VIEW)).rejects.toBeInstanceOf(
      authServer.ForbiddenError,
    );
  });

  it("caso 22: papel de empresa diferente do contexto resolvido não concede acesso", async () => {
    const companyA = await createTestCompanyWithRoles("rp-diff-companyA");
    const companyB = await createTestCompanyWithRoles("rp-diff-companyB");
    companyIds.push(companyA.id, companyB.id);
    const user = await createTestUser(companyA.id, "rp-diff-user");

    // Membership ACTIVE só em A (o contexto resolvido será A via LEGACY).
    await createTestMembership({ userId: user.id, companyId: companyA.id, status: "ACTIVE" });
    // Papel/permissão só existe em B — nunca deveria valer para o contexto A.
    await assignSystemRole(user.id, companyB.id, "ADMIN");

    loginAs(toSessionUser(user));

    await expect(authServer.requirePermission(PERMISSIONS.EMPLOYEE_VIEW)).rejects.toBeInstanceOf(
      authServer.ForbiddenError,
    );
  });

  it("caso 23: membership ACTIVE + papel correto no mesmo contexto concede acesso", async () => {
    const company = await createTestCompanyWithRoles("rp-happy-path");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "rp-happy-path");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });
    await assignSystemRole(user.id, company.id, "ADMIN");

    loginAs(toSessionUser(user));

    const ctx = await authServer.requirePermission(PERMISSIONS.EMPLOYEE_VIEW);
    expect(ctx.companyId).toBe(company.id);
  });

  it("caso 24: revogar a membership remove a autorização imediatamente, sem encerrar a sessão", async () => {
    const company = await createTestCompanyWithRoles("rp-revoke-live");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "rp-revoke-live");
    const membership = await createTestMembership({
      userId: user.id,
      companyId: company.id,
      status: "ACTIVE",
    });
    await assignSystemRole(user.id, company.id, "ADMIN");

    const sessionUser = toSessionUser(user);
    loginAs(sessionUser);

    // Sanity: com membership ACTIVE, a permissão é concedida.
    await expect(authServer.requirePermission(PERMISSIONS.EMPLOYEE_VIEW)).resolves.toMatchObject({
      companyId: company.id,
    });

    // Revoga a membership diretamente (simula uma ação administrativa
    // concorrente) — a sessão mockada (`h.current`) permanece EXATAMENTE a
    // mesma, provando que a autorização é revalidada a cada chamada, sem
    // precisar de logout/nova sessão.
    await prisma.companyMembership.update({
      where: { id: membership.id },
      data: { status: "REVOKED" },
    });

    await expect(authServer.requirePermission(PERMISSIONS.EMPLOYEE_VIEW)).rejects.toBeInstanceOf(
      authServer.ForbiddenError,
    );
  });
});
