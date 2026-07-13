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
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";
import { getOrCreateWarehouseLocation } from "@/lib/custodies";
import { _clearIdempotencyCacheForTests } from "@/lib/idempotency";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 19 — testes de
// integração direta contra `POST /api/custodies/deliver` (mesmo padrão de
// tests/tenant-isolation/companyid-manipulation.test.ts: mocka só a origem
// da sessão, toda a lógica de autorização/transação roda de verdade). O
// wizard em si (client) só monta o mesmo payload que o formulário antigo já
// montava — o contrato da API não mudou, então testar a rota aqui cobre o
// comportamento real de ponta a ponta sem precisar de jsdom.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: mockCookies,
}));

// `invalidateCompanyData` (lib/cache.ts) chama `revalidateTag`, que exige o
// "static generation store" (AsyncLocalStorage) de uma requisição real do
// Next — inexistente ao chamar `route.POST()` direto no Vitest. Isso é
// preexistente (não é algo que esta sprint introduziu — é por isso que não
// havia teste de integração direto desta rota antes: qualquer chamador
// bateria nesse mesmo invariant fora de um servidor Next real). Mocka só
// esse efeito colateral de cache, no mesmo espírito do mock de
// `next/headers` acima — a lógica de negócio sob teste continua real.
vi.mock("next/cache", () => ({
  revalidateTag: () => {},
  unstable_cache: <T,>(fn: T) => fn,
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => h.current } },
}));

function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let route: typeof import("@/app/api/custodies/deliver/route");
let returnRoute: typeof import("@/app/api/custodies/return/route");

const companyIds: string[] = [];

let companyA: { id: string };
let companyB: { id: string };
let adminA: TestSessionUser;
let consultaA: TestSessionUser;
let employeeA: { id: string };
let employeeB: { id: string };
let consumableAssetA: { id: string };
let consumableAssetB: { id: string };
let individualAssetA: { id: string };
let unitA1: { id: string };
let unitA2: { id: string };

function deliverRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/custodies/deliver", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  route = await import("@/app/api/custodies/deliver/route");
  returnRoute = await import("@/app/api/custodies/return/route");

  companyA = await createTestCompanyWithRoles("wizard-a");
  companyB = await createTestCompanyWithRoles("wizard-b");
  companyIds.push(companyA.id, companyB.id);

  const rawAdminA = await createTestUserWithMembership(companyA.id, "wizard-admin-a");
  await assignSystemRole(rawAdminA.id, companyA.id, "ADMIN");
  adminA = toSessionUser(rawAdminA);

  const rawConsultaA = await createTestUserWithMembership(companyA.id, "wizard-consulta-a");
  await assignSystemRole(rawConsultaA.id, companyA.id, "CONSULTA");
  consultaA = toSessionUser(rawConsultaA);

  employeeA = await createTestEmployee(companyA.id, "wizard-emp-a");
  employeeB = await createTestEmployee(companyB.id, "wizard-emp-b");

  const [{ statuses: statusesA, conditions: conditionsA }, { location: warehouseA }] = await Promise.all([
    provisionDefaultAssetStatusesAndConditions(companyA.id),
    provisionDefaultStockSetup(companyA.id),
  ]);
  const [{ statuses: statusesB, conditions: conditionsB }, { location: warehouseB }] = await Promise.all([
    provisionDefaultAssetStatusesAndConditions(companyB.id),
    provisionDefaultStockSetup(companyB.id),
  ]);
  void warehouseB;

  const categoryA = await prisma.assetCategory.create({ data: { companyId: companyA.id, name: "wizard-a-categoria" } });
  const categoryB = await prisma.assetCategory.create({ data: { companyId: companyB.id, name: "wizard-b-categoria" } });

  consumableAssetA = await prisma.asset.create({
    data: {
      companyId: companyA.id,
      assetCode: "WIZ-CONS-A",
      name: "Luva de teste (wizard)",
      categoryId: categoryA.id,
      statusId: statusesA.get("Disponível")!.id,
      conditionId: conditionsA.get("Novo")!.id,
      trackingMode: "CONSUMABLE",
      active: true,
    },
  });
  await prisma.stockBalance.create({
    data: { companyId: companyA.id, assetId: consumableAssetA.id, locationId: warehouseA.id, quantity: 5 },
  });

  consumableAssetB = await prisma.asset.create({
    data: {
      companyId: companyB.id,
      assetCode: "WIZ-CONS-B",
      name: "Luva de teste B (wizard)",
      categoryId: categoryB.id,
      statusId: statusesB.get("Disponível")!.id,
      conditionId: conditionsB.get("Novo")!.id,
      trackingMode: "CONSUMABLE",
      active: true,
    },
  });

  individualAssetA = await prisma.asset.create({
    data: {
      companyId: companyA.id,
      assetCode: "WIZ-IND-A",
      name: "Furadeira de teste (wizard)",
      categoryId: categoryA.id,
      statusId: statusesA.get("Disponível")!.id,
      conditionId: conditionsA.get("Novo")!.id,
      trackingMode: "INDIVIDUAL",
      active: true,
    },
  });
  unitA1 = await prisma.assetUnit.create({
    data: {
      companyId: companyA.id,
      assetId: individualAssetA.id,
      serialNumber: "WIZ-SN-001",
      statusId: statusesA.get("Disponível")!.id,
      conditionId: conditionsA.get("Novo")!.id,
      active: true,
    },
  });
  unitA2 = await prisma.assetUnit.create({
    data: {
      companyId: companyA.id,
      assetId: individualAssetA.id,
      serialNumber: "WIZ-SN-002",
      statusId: statusesA.get("Disponível")!.id,
      conditionId: conditionsA.get("Novo")!.id,
      active: true,
    },
  });
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

describe("Sprint Demo Comercial — Wizard de Nova Entrega: POST /api/custodies/deliver", () => {
  it("caso 34/35: companyId do body é ignorado — entrega persiste no tenant da sessão, nunca no injetado", async () => {
    loginAs(adminA);
    const res = await route.POST(
      deliverRequest({
        companyId: companyB.id, // valor malicioso
        employeeId: employeeA.id,
        assetId: consumableAssetA.id,
        quantity: 1,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { custody: { id: string } };
    const persisted = await prisma.assetCustody.findUniqueOrThrow({ where: { id: body.custody.id } });
    expect(persisted.companyId).toBe(companyA.id);
    expect(persisted.companyId).not.toBe(companyB.id);
  });

  it("caso 15: ativo de outra empresa é rejeitado, mesmo pertencendo a um colaborador válido", async () => {
    loginAs(adminA);
    const res = await route.POST(
      deliverRequest({ employeeId: employeeA.id, assetId: consumableAssetB.id, quantity: 1 }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toMatch(/P2002|PrismaClientKnownRequestError|at Object\.|node_modules/);
  });

  it("colaborador de outra empresa é rejeitado", async () => {
    loginAs(adminA);
    const res = await route.POST(
      deliverRequest({ employeeId: employeeB.id, assetId: consumableAssetA.id, quantity: 1 }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("caso 12/13: quantidade maior que o saldo é rejeitada (estoque nunca fica negativo)", async () => {
    loginAs(adminA);
    const res = await route.POST(
      deliverRequest({ employeeId: employeeA.id, assetId: consumableAssetA.id, quantity: 999 }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/[Ee]stoque/);

    const balance = await prisma.stockBalance.findFirst({ where: { assetId: consumableAssetA.id } });
    expect(Number(balance?.quantity)).toBeGreaterThanOrEqual(0);
  });

  it("caso 17/19: unidade em custódia não pode ser entregue de novo (dupla custódia bloqueada)", async () => {
    loginAs(adminA);
    const first = await route.POST(
      deliverRequest({ employeeId: employeeA.id, assetId: individualAssetA.id, assetUnitId: unitA1.id }),
    );
    expect(first.status).toBe(201);

    const second = await route.POST(
      deliverRequest({ employeeId: employeeA.id, assetId: individualAssetA.id, assetUnitId: unitA1.id }),
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/já está em custódia/);

    const activeCustodies = await prisma.assetCustody.count({
      where: { assetUnitId: unitA1.id, status: "ACTIVE" },
    });
    expect(activeCustodies).toBe(1);
  });

  it("caso 20: previsão de devolução é persistida quando informada para item serializado", async () => {
    loginAs(adminA);
    const expectedReturnAt = "2026-12-01T00:00:00.000Z";
    const res = await route.POST(
      deliverRequest({
        employeeId: employeeA.id,
        assetId: individualAssetA.id,
        assetUnitId: unitA2.id,
        expectedReturnAt,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { custody: { id: string } };
    const persisted = await prisma.assetCustody.findUniqueOrThrow({ where: { id: body.custody.id } });
    expect(persisted.expectedReturnAt?.toISOString()).toBe(expectedReturnAt);
  });

  it("caso 28: token de assinatura permanece opaco (não é o id da custódia nem sequencial)", async () => {
    loginAs(adminA);
    const res = await route.POST(
      deliverRequest({
        employeeId: employeeA.id,
        assetId: consumableAssetA.id,
        quantity: 1,
        signatureDelivery: "QR",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { custody: { id: string }; signUrl?: string };
    expect(body.signUrl).toBeTruthy();
    const token = body.signUrl!.split("/").pop()!;
    expect(token).not.toBe(body.custody.id);
    expect(token.length).toBeGreaterThanOrEqual(20);
  });

  it("caso 30: duas submissões com a mesma Idempotency-Key criam só UMA entrega", async () => {
    _clearIdempotencyCacheForTests();
    loginAs(adminA);
    const key = "wizard-test-idem-key-1";
    // Usa uma unidade fresca dedicada a este caso para não colidir com o
    // teste de dupla custódia acima.
    const freshUnit = await prisma.assetUnit.create({
      data: {
        companyId: companyA.id,
        assetId: individualAssetA.id,
        serialNumber: "WIZ-SN-IDEM-001",
        statusId: (await prisma.assetStatus.findFirstOrThrow({ where: { companyId: companyA.id, name: "Disponível" } })).id,
        conditionId: (await prisma.assetCondition.findFirstOrThrow({ where: { companyId: companyA.id, name: "Novo" } })).id,
        active: true,
      },
    });

    const [res1, res2] = await Promise.all([
      route.POST(deliverRequest({ employeeId: employeeA.id, assetId: individualAssetA.id, assetUnitId: freshUnit.id }, { "Idempotency-Key": key })),
      route.POST(deliverRequest({ employeeId: employeeA.id, assetId: individualAssetA.id, assetUnitId: freshUnit.id }, { "Idempotency-Key": key })),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const body1 = (await res1.json()) as { custody: { id: string } };
    const body2 = (await res2.json()) as { custody: { id: string } };
    expect(body1.custody.id).toBe(body2.custody.id);

    const count = await prisma.assetCustody.count({ where: { assetUnitId: freshUnit.id, status: "ACTIVE" } });
    expect(count).toBe(1);
  });

  it("caso 37: sem header Idempotency-Key (cliente antigo), a rota continua funcionando exatamente como antes", async () => {
    loginAs(adminA);
    const freshUnit = await prisma.assetUnit.create({
      data: {
        companyId: companyA.id,
        assetId: individualAssetA.id,
        serialNumber: "WIZ-SN-LEGACY-001",
        statusId: (await prisma.assetStatus.findFirstOrThrow({ where: { companyId: companyA.id, name: "Disponível" } })).id,
        conditionId: (await prisma.assetCondition.findFirstOrThrow({ where: { companyId: companyA.id, name: "Novo" } })).id,
        active: true,
      },
    });
    const res = await route.POST(
      deliverRequest({ employeeId: employeeA.id, assetId: individualAssetA.id, assetUnitId: freshUnit.id }),
    );
    expect(res.status).toBe(201);
  });

  it("caso 40: usuário sem custody:manage (CONSULTA) é bloqueado pela API mesmo que chame a rota diretamente", async () => {
    loginAs(consultaA);
    const res = await route.POST(deliverRequest({ employeeId: employeeA.id, assetId: consumableAssetA.id, quantity: 1 }));
    expect(res.status).toBe(403);
  });

  it("caso 38: rota de devolução continua exportando POST normalmente (não foi alterada por esta sprint)", () => {
    expect(typeof returnRoute.POST).toBe("function");
  });
});
