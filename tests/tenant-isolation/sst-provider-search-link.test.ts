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

// "trocar cadastro de SST para busca de SST cadastrada com seleção e
// autorização" — a empresa não cria mais um SstProvider do zero; busca
// entre os já cadastrados (globais), seleciona e vincula (POST cria só o
// SstProviderCompany, status PENDING). Autorizar continua sendo a ação
// separada já existente (PATCH /api/sst-providers/[id]), não alterada
// aqui. Mesmo padrão de mock de sessão de
// tests/tenant-isolation/companyid-manipulation.test.ts.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let searchRoute: typeof import("@/app/api/sst-providers/search/route");
let providersRoute: typeof import("@/app/api/sst-providers/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

let companyA: { id: string };
let companyB: { id: string };
let adminA: TestSessionUser;
let consultaA: TestSessionUser;

beforeAll(async () => {
  searchRoute = await import("@/app/api/sst-providers/search/route");
  providersRoute = await import("@/app/api/sst-providers/route");

  companyA = await createTestCompanyWithRoles("provsearch-a");
  companyB = await createTestCompanyWithRoles("provsearch-b");
  companyIds.push(companyA.id, companyB.id);

  const rawAdminA = await createTestUserWithMembership(companyA.id, "provsearch-admin-a");
  await assignSystemRole(rawAdminA.id, companyA.id, "ADMIN");
  adminA = toSessionUser(rawAdminA);

  const rawConsultaA = await createTestUserWithMembership(companyA.id, "provsearch-consulta-a");
  await assignSystemRole(rawConsultaA.id, companyA.id, "CONSULTA");
  consultaA = toSessionUser(rawConsultaA);
});

afterAll(async () => {
  loginAs(null);
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

function searchRequest(query: string) {
  return new NextRequest(`http://localhost/api/sst-providers/search?q=${encodeURIComponent(query)}`);
}

function linkRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/sst-providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/sst-providers/search", () => {
  it("não retorna nada para menos de 3 caracteres", async () => {
    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("ab"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: unknown[] };
    expect(body.providers).toEqual([]);
  });

  it("encontra um prestador ativo por nome (case-insensitive, parcial)", async () => {
    const provider = await prisma.sstProvider.create({
      data: { name: "Consultoria Busca Alfa 001", document: "00.000.000/0001-00", active: true },
    });
    providerIds.push(provider.id);

    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("busca alfa"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; name: string; document: string | null }[] };
    expect(body.providers.map((p) => p.id)).toContain(provider.id);
    expect(body.providers.find((p) => p.id === provider.id)?.document).toBe("00.000.000/0001-00");
  });

  it("resultados nunca incluem e-mail/telefone — só id/name/document", async () => {
    const provider = await prisma.sstProvider.create({
      data: { name: "Consultoria Busca Contato 002", email: "contato@example.test", phone: "119999", active: true },
    });
    providerIds.push(provider.id);

    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("busca contato"));
    const body = (await res.json()) as { providers: Record<string, unknown>[] };
    const found = body.providers.find((p) => p.id === provider.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty("email");
    expect(found).not.toHaveProperty("phone");
  });

  it("nunca retorna prestador inativo", async () => {
    const provider = await prisma.sstProvider.create({
      data: { name: "Consultoria Busca Inativa 003", active: false },
    });
    providerIds.push(provider.id);

    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("busca inativa"));
    const body = (await res.json()) as { providers: { id: string }[] };
    expect(body.providers.map((p) => p.id)).not.toContain(provider.id);
  });

  it("nunca retorna prestador que já tem vínculo (qualquer status) com esta empresa", async () => {
    const provider = await createTestProvider("provsearch-already-linked");
    providerIds.push(provider.id);
    await prisma.sstProvider.update({ where: { id: provider.id }, data: { name: "Consultoria Busca Vinculada 004" } });
    await linkProviderToCompany({ providerId: provider.id, companyId: companyA.id, status: "ACTIVE" });

    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("busca vinculada"));
    const body = (await res.json()) as { providers: { id: string }[] };
    expect(body.providers.map((p) => p.id)).not.toContain(provider.id);
  });

  it("um prestador vinculado à empresa B ainda aparece na busca da empresa A (vínculo é por empresa)", async () => {
    const provider = await createTestProvider("provsearch-linked-elsewhere");
    providerIds.push(provider.id);
    await prisma.sstProvider.update({ where: { id: provider.id }, data: { name: "Consultoria Busca Cruzada 005" } });
    await linkProviderToCompany({ providerId: provider.id, companyId: companyB.id, status: "ACTIVE" });

    loginAs(adminA);
    const res = await searchRoute.GET(searchRequest("busca cruzada"));
    const body = (await res.json()) as { providers: { id: string }[] };
    expect(body.providers.map((p) => p.id)).toContain(provider.id);
  });

  it("usuário sem sst_provider:manage (CONSULTA) é bloqueado", async () => {
    loginAs(consultaA);
    const res = await searchRoute.GET(searchRequest("qualquer"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/sst-providers — vincula prestador existente (nunca cria um novo)", () => {
  it("cria só o SstProviderCompany (PENDING) — o SstProvider não muda de contagem", async () => {
    const provider = await createTestProvider("provlink-existing");
    providerIds.push(provider.id);

    const before = await prisma.sstProvider.count();

    loginAs(adminA);
    const res = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "OPERATION" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { providerLink: { id: string; status: string; providerId: string } };
    expect(body.providerLink.status).toBe("PENDING");
    expect(body.providerLink.providerId).toBe(provider.id);

    const after = await prisma.sstProvider.count();
    expect(after).toBe(before);

    const link = await prisma.sstProviderCompany.findUnique({
      where: { providerId_companyId: { providerId: provider.id, companyId: companyA.id } },
    });
    expect(link?.status).toBe("PENDING");
  });

  it("duas empresas que vinculam o mesmo prestador apontam pro mesmo SstProvider (dedup)", async () => {
    const provider = await createTestProvider("provlink-dedup");
    providerIds.push(provider.id);

    loginAs(adminA);
    const resA = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "OPERATION" }));
    expect(resA.status).toBe(201);

    const rawAdminB = await createTestUserWithMembership(companyB.id, "provlink-admin-b");
    await assignSystemRole(rawAdminB.id, companyB.id, "ADMIN");
    loginAs(toSessionUser(rawAdminB));
    const resB = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "VIEW" }));
    expect(resB.status).toBe(201);

    const bodyA = (await resA.json()) as { providerLink: { providerId: string } };
    const bodyB = (await resB.json()) as { providerLink: { providerId: string } };
    expect(bodyA.providerLink.providerId).toBe(provider.id);
    expect(bodyB.providerLink.providerId).toBe(provider.id);

    const linksForProvider = await prisma.sstProviderCompany.count({ where: { providerId: provider.id } });
    expect(linksForProvider).toBe(2);
    const providerCount = await prisma.sstProvider.count({ where: { id: provider.id } });
    expect(providerCount).toBe(1);
  });

  it("rejeita providerId inexistente", async () => {
    loginAs(adminA);
    const res = await providersRoute.POST(linkRequest({ providerId: "does-not-exist", accessLevel: "OPERATION" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejeita providerId de um prestador inativo", async () => {
    const provider = await prisma.sstProvider.create({ data: { name: "Prestador Inativo Link Test", active: false } });
    providerIds.push(provider.id);

    loginAs(adminA);
    const res = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "OPERATION" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejeita vincular um prestador que já tem vínculo com esta empresa (409)", async () => {
    const provider = await createTestProvider("provlink-conflict");
    providerIds.push(provider.id);
    await linkProviderToCompany({ providerId: provider.id, companyId: companyA.id, status: "ACTIVE" });

    loginAs(adminA);
    const res = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "OPERATION" }));
    expect(res.status).toBe(409);
  });

  it("regressão: o payload antigo (name/document/email/phone, sem providerId) não cria mais nada — falha de validação", async () => {
    const before = await prisma.sstProvider.count();
    loginAs(adminA);
    const res = await providersRoute.POST(
      linkRequest({ name: "Tentativa Antiga", document: "123", email: "a@a.com", accessLevel: "OPERATION" }),
    );
    expect(res.status).toBe(400);
    const after = await prisma.sstProvider.count();
    expect(after).toBe(before);
  });

  it("usuário sem sst_provider:manage (CONSULTA) não consegue vincular", async () => {
    const provider = await createTestProvider("provlink-forbidden");
    providerIds.push(provider.id);

    loginAs(consultaA);
    const res = await providersRoute.POST(linkRequest({ providerId: provider.id, accessLevel: "OPERATION" }));
    expect(res.status).toBe(403);
  });
});
