import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createTestCompanyWithRoles,
  createTestEmployee,
  createTestUserWithMembership,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies } from "@/tests/helpers/mock-request-context";

// --- Mock do limite de sessão -----------------------------------------------
// Substituímos APENAS a origem da sessão (Better Auth + next/headers). Toda a
// lógica real de requireCompany/requirePermission (lib/auth-server.ts) roda de
// verdade contra o banco — é justamente ela que está sob teste. `cookies()`
// é mockado (sempre vazio aqui) porque requireCompany() agora também lê o
// contexto solicitado via lib/company-context-request.ts (Sprint 0.5).
const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: mockCookies,
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.current } },
}));

function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

// Importado DEPOIS dos mocks (a rota importa requirePermission de auth-server,
// que por sua vez importa `auth`). Import dinâmico garante a ordem.
let route: typeof import("@/app/api/employees/route");

// Fixtures
let companyA: { id: string };
let companyB: { id: string };
let userA: TestSessionUser;
let employeeAId: string;
let employeeBId: string;

beforeAll(async () => {
  route = await import("@/app/api/employees/route");

  companyA = await createTestCompanyWithRoles("A");
  companyB = await createTestCompanyWithRoles("B");

  const rawUserA = await createTestUserWithMembership(companyA.id, "adminA");
  await assignSystemRole(rawUserA.id, companyA.id, "ADMIN");
  userA = toSessionUser(rawUserA);

  employeeAId = (await createTestEmployee(companyA.id, "empA")).id;
  employeeBId = (await createTestEmployee(companyB.id, "empB")).id;
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({ companyIds: [companyA.id, companyB.id] });
  await prisma.$disconnect();
});

describe("Caso 5 — manipulação de companyId numa rota de negócio", () => {
  it("GET ignora ?companyId de outra empresa e só retorna dados do tenant da sessão", async () => {
    loginAs(userA);

    // Cliente tenta forçar a empresa B via query string.
    const req = new NextRequest(
      `http://localhost/api/employees?companyId=${companyB.id}`,
      { method: "GET" },
    );
    const res = await route.GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { employees: Array<{ id: string; companyId: string }> };
    const ids = body.employees.map((e) => e.id);
    const companyIds = new Set(body.employees.map((e) => e.companyId));

    // Só dados da empresa A (tenant da sessão); nada da empresa B injetada.
    expect(companyIds).toEqual(new Set([companyA.id]));
    expect(ids).toContain(employeeAId);
    expect(ids).not.toContain(employeeBId);
  });

  it("POST ignora companyId no body e persiste o registro no tenant da sessão", async () => {
    loginAs(userA);

    const req = new NextRequest("http://localhost/api/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Valor malicioso: tenta criar dentro da empresa B.
        companyId: companyB.id,
        name: `${"__tenant_test__"}novo-colab`,
        document: "99999999000191",
      }),
    });

    const res = await route.POST(req);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { employee: { id: string; companyId: string } };

    // O registro nasceu na empresa A (sessão), NUNCA na B (body).
    expect(body.employee.companyId).toBe(companyA.id);

    const persisted = await prisma.employee.findUnique({ where: { id: body.employee.id } });
    expect(persisted?.companyId).toBe(companyA.id);
    expect(persisted?.companyId).not.toBe(companyB.id);

    // Nenhum registro vazou para a empresa B.
    const countB = await prisma.employee.count({
      where: { companyId: companyB.id, id: body.employee.id },
    });
    expect(countB).toBe(0);
  });

  it("sem sessão, a rota nega (401) e não retorna dados", async () => {
    loginAs(null);

    const req = new NextRequest("http://localhost/api/employees", { method: "GET" });
    const res = await route.GET(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { employees?: unknown };
    expect(body.employees).toBeUndefined();
  });
});
