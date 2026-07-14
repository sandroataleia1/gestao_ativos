import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  cleanupFixtures,
  createProviderUser,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestProvider,
  createTestUser,
  linkProviderToCompany,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { withValidCheckDigits } from "@/lib/cnpj";

// Sprint Comercial SST 1.4 — pré-cadastro de empresa e solicitação de
// autorização a partir do CNPJ (§9-§13/§20). Mesmo padrão de mock de sessão
// de tests/tenant-isolation/sst-team-management.test.ts.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let checkRoute: typeof import("@/app/api/sst/companies/check-cnpj/route");
let preRegisterRoute: typeof import("@/app/api/sst/companies/pre-register/route");
let requestAccessRoute: typeof import("@/app/api/sst/companies/request-access/route");

const companyIds: string[] = [];
const providerIds: string[] = [];
let seq = 0;

function uniqueCnpj(): string {
  seq += 1;
  const base = `${Date.now()}${seq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

beforeAll(async () => {
  checkRoute = await import("@/app/api/sst/companies/check-cnpj/route");
  preRegisterRoute = await import("@/app/api/sst/companies/pre-register/route");
  requestAccessRoute = await import("@/app/api/sst/companies/request-access/route");
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeProvider(label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  return provider;
}

async function makeProviderUser(providerId: string, label: string, role: "OWNER" | "TECHNICIAN" | "VIEWER") {
  const anchorCompany = await createTestCompany(`${label}-anchor`);
  companyIds.push(anchorCompany.id);
  const raw = await createTestUser(anchorCompany.id, label);
  await createProviderUser({ providerId, userId: raw.id, role });
  return toSessionUser(raw);
}

function checkRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sst/companies/check-cnpj", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function preRegisterRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sst/companies/pre-register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function requestAccessRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sst/companies/request-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Permissão — só OWNER inicia pré-cadastro/solicitação (§9)", () => {
  it("TECHNICIAN é bloqueado nos três endpoints", async () => {
    const provider = await makeProvider("perm-tech");
    const tech = await makeProviderUser(provider.id, "perm-tech-u", "TECHNICIAN");
    loginAs(tech);

    const cnpj = uniqueCnpj();
    expect((await checkRoute.POST(checkRequest({ cnpj }))).status).toBe(403);
    expect((await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "X" }))).status).toBe(403);
    expect((await requestAccessRoute.POST(requestAccessRequest({ cnpj }))).status).toBe(403);
  });

  it("VIEWER é bloqueado nos três endpoints", async () => {
    const provider = await makeProvider("perm-view");
    const viewer = await makeProviderUser(provider.id, "perm-view-u", "VIEWER");
    loginAs(viewer);

    const cnpj = uniqueCnpj();
    expect((await checkRoute.POST(checkRequest({ cnpj }))).status).toBe(403);
    expect((await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "X" }))).status).toBe(403);
    expect((await requestAccessRoute.POST(requestAccessRequest({ cnpj }))).status).toBe(403);
  });
});

describe("POST /api/sst/companies/check-cnpj (§10 fase 1, §18)", () => {
  it("CNPJ inexistente -> AVAILABLE_FOR_PRE_REGISTRATION", async () => {
    const provider = await makeProvider("check-avail");
    const owner = await makeProviderUser(provider.id, "check-avail-u", "OWNER");
    loginAs(owner);

    const res = await checkRoute.POST(checkRequest({ cnpj: uniqueCnpj() }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("AVAILABLE_FOR_PRE_REGISTRATION");
  });

  it("rejeita CNPJ inválido", async () => {
    const provider = await makeProvider("check-invalid");
    const owner = await makeProviderUser(provider.id, "check-invalid-u", "OWNER");
    loginAs(owner);

    const res = await checkRoute.POST(checkRequest({ cnpj: "11.111.111/1111-11" }));
    expect(res.status).toBe(400);
  });

  it("empresa existente sem vínculo -> AUTHORIZATION_REQUIRED, sem revelar nome/id", async () => {
    const providerA = await makeProvider("check-req-a");
    const ownerA = await makeProviderUser(providerA.id, "check-req-a-u", "OWNER");
    const company = await createTestCompanyWithRoles("check-req-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });

    loginAs(ownerA);
    const res = await checkRoute.POST(checkRequest({ cnpj }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("AUTHORIZATION_REQUIRED");
    expect(JSON.stringify(body)).not.toContain(company.id);
    expect(body).not.toHaveProperty("companyName");
  });

  it("empresa SUSPENDED sem vínculo -> COMPANY_UNAVAILABLE", async () => {
    const provider = await makeProvider("check-suspended");
    const owner = await makeProviderUser(provider.id, "check-suspended-u", "OWNER");
    const company = await createTestCompanyWithRoles("check-suspended-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj, operationalStatus: "SUSPENDED" },
    });

    loginAs(owner);
    const res = await checkRoute.POST(checkRequest({ cnpj }));
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("COMPANY_UNAVAILABLE");
  });
});

describe("POST /api/sst/companies/pre-register (§11)", () => {
  it("cria Company UNCLAIMED/SST_PROVIDER + link ACTIVE/ADMINISTRATION atomicamente", async () => {
    const provider = await makeProvider("prereg-ok");
    const owner = await makeProviderUser(provider.id, "prereg-ok-u", "OWNER");
    loginAs(owner);

    const cnpj = uniqueCnpj();
    const res = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Prereg" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { company: { id: string }; link: { id: string } };
    companyIds.push(body.company.id);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: body.company.id } });
    expect(company.controlStatus).toBe("UNCLAIMED");
    expect(company.origin).toBe("SST_PROVIDER");
    expect(company.createdByProviderId).toBe(provider.id);
    expect(company.documentNormalized).toBe(cnpj);

    const link = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: provider.id, companyId: company.id } },
    });
    expect(link.status).toBe("ACTIVE");
    expect(link.accessLevel).toBe("ADMINISTRATION");
  });

  it("ignora providerId/companyId/controlStatus/origin/createdByProviderId/accessLevel/status enviados no body", async () => {
    const provider = await makeProvider("prereg-ignore");
    const owner = await makeProviderUser(provider.id, "prereg-ignore-u", "OWNER");
    const otherProvider = await makeProvider("prereg-ignore-other");
    loginAs(owner);

    const cnpj = uniqueCnpj();
    const res = await preRegisterRoute.POST(
      preRegisterRequest({
        cnpj,
        name: "__tenant_test__ Empresa Prereg Ignore",
        providerId: otherProvider.id,
        companyId: "forjado",
        controlStatus: "CLAIMED",
        origin: "SELF_REGISTRATION",
        createdByProviderId: otherProvider.id,
        accessLevel: "VIEW",
        status: "PENDING",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { company: { id: string } };
    companyIds.push(body.company.id);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: body.company.id } });
    expect(company.createdByProviderId).toBe(provider.id); // nunca o otherProvider forjado
    expect(company.controlStatus).toBe("UNCLAIMED");
    expect(company.origin).toBe("SST_PROVIDER");

    const link = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: provider.id, companyId: company.id } },
    });
    expect(link.status).toBe("ACTIVE");
    expect(link.accessLevel).toBe("ADMINISTRATION");
  });

  it("nunca cria uma segunda empresa para o mesmo CNPJ (mesma consultoria repetindo -> ALREADY_PROVISIONALLY_AUTHORIZED, 200)", async () => {
    const provider = await makeProvider("prereg-dup");
    const owner = await makeProviderUser(provider.id, "prereg-dup-u", "OWNER");
    loginAs(owner);
    const cnpj = uniqueCnpj();

    const res1 = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Dup 1" }));
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { company: { id: string } };
    companyIds.push(body1.company.id);

    const res2 = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Dup 2" }));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { created: boolean; reason: string };
    expect(body2.created).toBe(false);
    // Cenário C: a mesma consultoria que pré-cadastrou já tem ACTIVE só por
    // PROVIDER_PRE_REGISTRATION — provisório, nunca ALREADY_AUTHORIZED puro.
    expect(body2.reason).toBe("ALREADY_PROVISIONALLY_AUTHORIZED");

    const count = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(count).toBe(1);
  });

  it("nunca cria uma segunda empresa para o mesmo CNPJ (outra consultoria -> pedido PENDING, 409)", async () => {
    const providerA = await makeProvider("prereg-dup-a");
    const ownerA = await makeProviderUser(providerA.id, "prereg-dup-a-u", "OWNER");
    const providerB = await makeProvider("prereg-dup-b");
    const ownerB = await makeProviderUser(providerB.id, "prereg-dup-b-u", "OWNER");
    const cnpj = uniqueCnpj();

    loginAs(ownerA);
    const res1 = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Dup A" }));
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { company: { id: string } };
    companyIds.push(body1.company.id);

    loginAs(ownerB);
    const res2 = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Dup B" }));
    expect(res2.status).toBe(409);
    const body2 = (await res2.json()) as { created: boolean; reason: string };
    expect(body2.created).toBe(false);
    expect(body2.reason).toBe("AUTHORIZATION_REQUESTED");

    const count = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(count).toBe(1);
    const linkB = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: providerB.id, companyId: body1.company.id } },
    });
    expect(linkB.status).toBe("PENDING");
  });

  it("duas requisições concorrentes com o mesmo CNPJ criam só uma Company (mesma consultoria — Promise.all real contra o banco)", async () => {
    // Mesma sessão/provider para as duas requisições concorrentes — o mock
    // de sessão deste arquivo (`h.current`, compartilhado globalmente) não
    // sustenta duas IDENTIDADES logadas simultâneas de verdade dentro de um
    // único Promise.all (mesmo padrão/limitação já observado em
    // tests/tenant-isolation/delivery-wizard-deliver-route.test.ts, caso de
    // dupla submissão por Idempotency-Key: usa sempre o mesmo ator). O que
    // importa aqui é a garantia no nível do banco: a constraint única
    // (documentType, documentNormalized) — nunca duas Company para o mesmo
    // CNPJ mesmo sob corrida real de duas transações concorrentes.
    const provider = await makeProvider("prereg-race");
    const owner = await makeProviderUser(provider.id, "prereg-race-u", "OWNER");
    loginAs(owner);
    const cnpj = uniqueCnpj();

    const [res1, res2] = await Promise.all([
      preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Corrida 1" })),
      preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Corrida 2" })),
    ]);
    const statuses = [res1.status, res2.status].sort();
    // Um vence (201, cria a empresa); o outro nunca cria uma segunda
    // Company — cai no fluxo seguro de empresa existente e, como é a MESMA
    // consultoria, encontra o próprio vínculo ACTIVE (200, ALREADY_AUTHORIZED).
    expect(statuses).toEqual([200, 201]);

    const winner = res1.status === 201 ? res1 : res2;
    const winnerBody = (await winner.json()) as { company: { id: string } };
    companyIds.push(winnerBody.company.id);

    const count = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(count).toBe(1);

    const links = await prisma.sstProviderCompany.count({ where: { providerId: provider.id, companyId: winnerBody.company.id } });
    expect(links).toBe(1); // nunca duplica o vínculo da mesma consultoria
  });

  it("duas consultorias DIFERENTES disputando o mesmo CNPJ: só uma vira ADMINISTRATION, a outra só registra PENDING", async () => {
    // Chama lib/sst-company-provisioning.ts diretamente (sem passar pela
    // rota/mock de sessão) — o mock de sessão deste arquivo é um único
    // `h.current` global e não sustenta duas identidades logadas
    // simultâneas dentro do mesmo Promise.all; a função de serviço já
    // recebe `providerId`/`actor` explícitos, então dá pra simular a
    // corrida real entre dois atores distintos sem essa limitação.
    const { preRegisterCompany } = await import("@/lib/sst-company-provisioning");

    const providerX = await makeProvider("prereg-race2-x");
    const rawX = await createTestUser((await createTestCompany("prereg-race2-x-anchor")).id, "prereg-race2-x-u");
    companyIds.push(rawX.companyId);
    await createProviderUser({ providerId: providerX.id, userId: rawX.id, role: "OWNER" });

    const providerY = await makeProvider("prereg-race2-y");
    const rawY = await createTestUser((await createTestCompany("prereg-race2-y-anchor")).id, "prereg-race2-y-u");
    companyIds.push(rawY.companyId);
    await createProviderUser({ providerId: providerY.id, userId: rawY.id, role: "OWNER" });

    const cnpj = uniqueCnpj();
    const [resultX, resultY] = await Promise.all([
      preRegisterCompany(providerX.id, { id: rawX.id, name: rawX.name }, { cnpj, name: "__tenant_test__ Empresa Corrida X2" }),
      preRegisterCompany(providerY.id, { id: rawY.id, name: rawY.name }, { cnpj, name: "__tenant_test__ Empresa Corrida Y2" }),
    ]);

    const created = [resultX, resultY].filter((r) => r.created);
    const notCreated = [resultX, resultY].filter((r) => !r.created);
    expect(created).toHaveLength(1);
    expect(notCreated).toHaveLength(1);

    const winnerCompanyId = created[0].created ? created[0].company.id : undefined;
    expect(winnerCompanyId).toBeDefined();
    companyIds.push(winnerCompanyId!);

    const count = await prisma.company.count({ where: { id: winnerCompanyId! } });
    expect(count).toBe(1);
    const totalCompaniesWithCnpj = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(totalCompaniesWithCnpj).toBe(1);

    const winnerProviderId = resultX.created ? providerX.id : providerY.id;
    const loserProviderId = resultX.created ? providerY.id : providerX.id;

    const winnerLink = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: winnerProviderId, companyId: winnerCompanyId! } },
    });
    expect(winnerLink.status).toBe("ACTIVE");
    expect(winnerLink.accessLevel).toBe("ADMINISTRATION");

    const loserLink = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: loserProviderId, companyId: winnerCompanyId! } },
    });
    expect(loserLink.status).toBe("PENDING");
    expect(loserLink.accessLevel).not.toBe("ADMINISTRATION");
  });
});

describe("POST /api/sst/companies/request-access (§12/§13)", () => {
  it("empresa sem vínculo -> cria PENDING, nunca concede acesso imediato", async () => {
    const provider = await makeProvider("reqacc-pending");
    const owner = await makeProviderUser(provider.id, "reqacc-pending-u", "OWNER");
    const company = await createTestCompanyWithRoles("reqacc-pending-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });

    loginAs(owner);
    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("AUTHORIZATION_REQUESTED");

    const link = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: provider.id, companyId: company.id } },
    });
    expect(link.status).toBe("PENDING");
  });

  it("empresa inexistente -> 404, nenhum vínculo criado", async () => {
    const provider = await makeProvider("reqacc-404");
    const owner = await makeProviderUser(provider.id, "reqacc-404-u", "OWNER");
    loginAs(owner);

    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj: uniqueCnpj() }));
    expect(res.status).toBe(404);
  });

  it("vínculo já ACTIVE -> não duplica, devolve ALREADY_AUTHORIZED", async () => {
    const provider = await makeProvider("reqacc-active");
    const owner = await makeProviderUser(provider.id, "reqacc-active-u", "OWNER");
    const company = await createTestCompanyWithRoles("reqacc-active-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });
    await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE" });

    loginAs(owner);
    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ALREADY_AUTHORIZED");

    const count = await prisma.sstProviderCompany.count({ where: { providerId: provider.id, companyId: company.id } });
    expect(count).toBe(1);
  });

  it("vínculo já PENDING -> não duplica, devolve AUTHORIZATION_PENDING", async () => {
    const provider = await makeProvider("reqacc-pend2");
    const owner = await makeProviderUser(provider.id, "reqacc-pend2-u", "OWNER");
    const company = await createTestCompanyWithRoles("reqacc-pend2-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });
    await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING" });

    loginAs(owner);
    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("AUTHORIZATION_PENDING");

    const count = await prisma.sstProviderCompany.count({ where: { providerId: provider.id, companyId: company.id } });
    expect(count).toBe(1);
  });

  for (const status of ["SUSPENDED", "REVOKED", "REJECTED"] as const) {
    it(`vínculo ${status} -> nunca reativa automaticamente (409)`, async () => {
      const provider = await makeProvider(`reqacc-${status.toLowerCase()}`);
      const owner = await makeProviderUser(provider.id, `reqacc-${status.toLowerCase()}-u`, "OWNER");
      const company = await createTestCompanyWithRoles(`reqacc-${status.toLowerCase()}-company`);
      companyIds.push(company.id);
      const cnpj = uniqueCnpj();
      await prisma.company.update({
        where: { id: company.id },
        data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
      });
      await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status });

      loginAs(owner);
      const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
      expect(res.status).toBe(409);

      const link = await prisma.sstProviderCompany.findUniqueOrThrow({
        where: { providerId_companyId: { providerId: provider.id, companyId: company.id } },
      });
      expect(link.status).toBe(status); // nunca mudou de status sozinho
    });
  }

  it("empresa UNCLAIMED criada por outra consultoria -> segunda consultoria só registra PENDING, nunca vira administradora (§13)", async () => {
    const providerA = await makeProvider("reqacc-unclaimed-a");
    const ownerA = await makeProviderUser(providerA.id, "reqacc-unclaimed-a-u", "OWNER");
    const providerB = await makeProvider("reqacc-unclaimed-b");
    const ownerB = await makeProviderUser(providerB.id, "reqacc-unclaimed-b-u", "OWNER");

    loginAs(ownerA);
    const cnpj = uniqueCnpj();
    const preRes = await preRegisterRoute.POST(preRegisterRequest({ cnpj, name: "__tenant_test__ Empresa Unclaimed" }));
    expect(preRes.status).toBe(201);
    const preBody = (await preRes.json()) as { company: { id: string } };
    companyIds.push(preBody.company.id);

    loginAs(ownerB);
    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("AUTHORIZATION_REQUESTED");

    const linkB = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: providerB.id, companyId: preBody.company.id } },
    });
    expect(linkB.status).toBe("PENDING");
    expect(linkB.accessLevel).not.toBe("ADMINISTRATION");

    // A consultoria A continua ADMINISTRATION/ACTIVE, intocada.
    const linkA = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: providerA.id, companyId: preBody.company.id } },
    });
    expect(linkA.status).toBe("ACTIVE");
    expect(linkA.accessLevel).toBe("ADMINISTRATION");
  });

  it("empresa SUSPENDED sem vínculo -> nunca cria acesso (mensagem genérica)", async () => {
    const provider = await makeProvider("reqacc-suspended");
    const owner = await makeProviderUser(provider.id, "reqacc-suspended-u", "OWNER");
    const company = await createTestCompanyWithRoles("reqacc-suspended-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj, operationalStatus: "SUSPENDED" },
    });

    loginAs(owner);
    const res = await requestAccessRoute.POST(requestAccessRequest({ cnpj }));
    expect(res.status).toBe(400);

    const count = await prisma.sstProviderCompany.count({ where: { providerId: provider.id, companyId: company.id } });
    expect(count).toBe(0);
  });
});
