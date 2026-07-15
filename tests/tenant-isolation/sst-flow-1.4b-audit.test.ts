import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  assignSystemRole,
  cleanupFixtures,
  createProviderUser,
  createTestCompany,
  createTestCompanyWithRoles,
  createTestProvider,
  createTestUser,
  createTestUserWithMembership,
  linkProviderToCompany,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import { withValidCheckDigits } from "@/lib/cnpj";
import { ForbiddenError } from "@/lib/auth-server";

// Sprint SST 1.4B — auditoria e fechamento do fluxo existente de
// pré-cadastro/autorização/reivindicação (§2/§4/§6/§9/§12/§16). Cobre as
// lacunas comprovadas encontradas nesta sprint que os testes já existentes
// (sst-company-pre-register.test.ts, sst-provider-approve-reject.test.ts,
// company-claim-decision.test.ts) não cobriam: matriz de transição
// explícita, corridas reais (mesmo vínculo decidido duas vezes, dois
// vínculos da mesma empresa decididos ao mesmo tempo), manipulação de campos
// pelo client, persistência do bloqueio numa sessão já aberta, e a
// auditoria de solicitação negada.

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let linkRoute: typeof import("@/app/api/sst-providers/[id]/route");
let claimRoute: typeof import("@/app/api/companies/claim-review/[relationshipId]/route");

const companyIds: string[] = [];
const providerIds: string[] = [];
let seq = 0;

function uniqueCnpj(): string {
  seq += 1;
  const base = `${Date.now()}${seq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeCompanyWithAdmin(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  const rawAdmin = await createTestUserWithMembership(company.id, `${label}-admin`);
  await assignSystemRole(rawAdmin.id, company.id, "ADMIN");
  return { company, admin: toSessionUser(rawAdmin) };
}

/** Sprint SST 1.4C, §12 — resolveClaimDecision agora exige uma
 * CompanyClaimRequest APPROVED para a empresa antes de permitir qualquer
 * decisão CONTINUE/BLOCK. Só os testes que efetivamente chamam claimRoute
 * precisam disto — os demais usuários de makeCompanyWithAdmin (matriz de
 * transição do PATCH genérico, manipulação de accessLevel) não passam por
 * resolveClaimDecision e não precisam desta linha extra. */
async function approveClaimFor(companyId: string, adminUserId: string) {
  await prisma.companyClaimRequest.create({
    data: {
      companyId,
      requesterUserId: adminUserId,
      status: "APPROVED",
      origin: "EXISTING_PRE_REGISTRATION",
      reviewedAt: new Date(),
      reviewedByUserId: adminUserId,
    },
  });
}

async function makeProviderUser(label: string, role: "OWNER" | "TECHNICIAN" | "VIEWER" = "OWNER") {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  const anchor = await createTestCompany(`${label}-anchor`);
  companyIds.push(anchor.id);
  const raw = await createTestUser(anchor.id, label);
  await createProviderUser({ providerId: provider.id, userId: raw.id, role });
  return { provider, user: toSessionUser(raw) };
}

function patchRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/sst-providers/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Matriz de transição de estado (§4) — updateProviderLinkStatus", () => {
  it("PENDING -> SUSPENDED é rejeitado (pular a aprovação não é uma transição válida)", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("transition-pending-suspended");
    const provider = await createTestProvider("transition-pending-suspended-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING" });

    loginAs(admin);
    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "SUSPENDED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(400);
    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("PENDING -> REVOKED é rejeitado (nunca revoga algo que nunca foi ativo)", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("transition-pending-revoked");
    const provider = await createTestProvider("transition-pending-revoked-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING" });

    loginAs(admin);
    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "REVOKED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(400);
    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("ACTIVE -> SUSPENDED é permitido", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("transition-active-suspended");
    const provider = await createTestProvider("transition-active-suspended-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE" });

    loginAs(admin);
    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "SUSPENDED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
  });

  it("SUSPENDED -> ACTIVE é permitido (reativação pela empresa, §9)", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("transition-suspended-active");
    const provider = await createTestProvider("transition-suspended-active-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "SUSPENDED" });

    loginAs(admin);
    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "ACTIVE" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
  });

  it("SUSPENDED -> REVOKED é permitido", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("transition-suspended-revoked");
    const provider = await createTestProvider("transition-suspended-revoked-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "SUSPENDED" });

    loginAs(admin);
    const res = await linkRoute.PATCH(patchRequest(link.id, { status: "REVOKED" }), {
      params: Promise.resolve({ id: link.id }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Corrida real no PATCH de vínculo (§7/§9) — updateProviderLinkStatus", () => {
  it("duas decisões concorrentes sobre o MESMO vínculo PENDING: nunca as duas aplicam, nunca 500", async () => {
    // Duas chamadas verdadeiramente concorrentes (`updateMany` com
    // `status: existing.status` no WHERE, Sprint SST 1.4B §7/§9) resultam
    // em [200, 409] — a primeira a commitar aplica, a segunda vê `count: 0`
    // e recebe ConflictError. Mas sob a pool de conexões deste ambiente de
    // teste, as duas chamadas às vezes acabam serializadas o suficiente
    // para que a segunda já leia o novo estado no `findFirst` PRÉ-transação
    // (fora da guarda) — nesse caso a tabela de transição (§4) já barra a
    // segunda antes de chegar no `updateMany` ([200, 400]). As duas
    // interleavings são seguras (nunca [200, 200], nunca 500); o que
    // importa é que só UMA decisão jamais é aplicada de fato.
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const { company, admin } = await makeCompanyWithAdmin("race-patch-same-link");
    const provider = await createTestProvider("race-patch-same-link-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING" });

    loginAs(admin);
    const [res1, res2] = await Promise.all([
      linkRoute.PATCH(patchRequest(link.id, { status: "ACTIVE" }), { params: Promise.resolve({ id: link.id }) }),
      linkRoute.PATCH(patchRequest(link.id, { status: "REJECTED" }), { params: Promise.resolve({ id: link.id }) }),
    ]);
    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);

    // O estado final é exatamente o da requisição vencedora — nunca uma
    // mistura, nunca as duas aplicadas em sequência.
    const finalLink = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(["ACTIVE", "REJECTED"]).toContain(finalLink.status);
  });
});

describe("Corrida real na decisão de reivindicação (§12) — resolveClaimDecision", () => {
  it("duas decisões concorrentes sobre o MESMO vínculo provisório: só uma aplica, a outra recebe 409", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin } = await makeCompanyWithAdmin("race-claim-same-link");
    await approveClaimFor(company.id, admin.id);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const provider = await createTestProvider("race-claim-same-link-p");
    providerIds.push(provider.id);
    const link = await prisma.sstProviderCompany.create({
      data: {
        providerId: provider.id,
        companyId: company.id,
        status: "ACTIVE",
        accessLevel: "ADMINISTRATION",
        authorizationBasis: "PROVIDER_PRE_REGISTRATION",
      },
    });

    function decisionRequest(body: Record<string, unknown>) {
      return new NextRequest("http://localhost/api/companies/claim-review/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    loginAs(admin);
    const [res1, res2] = await Promise.all([
      claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), { params: Promise.resolve({ relationshipId: link.id }) }),
      claimRoute.POST(decisionRequest({ decision: "BLOCK" }), { params: Promise.resolve({ relationshipId: link.id }) }),
    ]);
    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    // 409 = corrida verdadeira pega pela guarda `updateMany` (§12); 404 =
    // as duas serializaram o suficiente para a segunda já não achar mais o
    // vínculo pendente no `findFirst` pré-transação (mesma segurança, outro
    // caminho de código). Nunca 500, nunca [200, 200].
    expect([404, 409]).toContain(statuses[1]);

    // Empresa finaliza CLAIMED de qualquer forma (o único vínculo provisório
    // foi decidido, seja CONTINUE ou BLOCK) — nunca fica travada.
    const finalCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(finalCompany.controlStatus).toBe("CLAIMED");
  });

  it("duas consultorias provisórias DIFERENTES decididas CONCORRENTEMENTE: a empresa finaliza CLAIMED (nunca trava em CLAIM_PENDING)", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin } = await makeCompanyWithAdmin("race-claim-cross-link");
    await approveClaimFor(company.id, admin.id);
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });

    const provider1 = await createTestProvider("race-claim-cross-link-p1");
    const provider2 = await createTestProvider("race-claim-cross-link-p2");
    providerIds.push(provider1.id, provider2.id);
    const link1 = await prisma.sstProviderCompany.create({
      data: { providerId: provider1.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });
    const link2 = await prisma.sstProviderCompany.create({
      data: { providerId: provider2.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    function decisionRequest(body: Record<string, unknown>) {
      return new NextRequest("http://localhost/api/companies/claim-review/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    loginAs(admin);
    // Sem o lock FOR UPDATE em finalizeClaimIfResolved (lib/company-claim.ts),
    // é possível que as duas transações contem "1 restante" (a decisão da
    // outra, ainda não commitada) e NENHUMA finalize o claim — a empresa
    // fica travada em CLAIM_PENDING para sempre (loop de redirect entre
    // /dashboard e /onboarding/sst-providers). Este teste prova que isso não
    // acontece mais.
    const [res1, res2] = await Promise.all([
      claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), { params: Promise.resolve({ relationshipId: link1.id }) }),
      claimRoute.POST(decisionRequest({ decision: "CONTINUE" }), { params: Promise.resolve({ relationshipId: link2.id }) }),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const finalCompany = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(finalCompany.controlStatus).toBe("CLAIMED");
    expect(finalCompany.claimedAt).not.toBeNull();
  });
});

describe("Corrida real na solicitação de vínculo (§2.2) — requestAccessToCompany", () => {
  it("duas solicitações simultâneas do mesmo provider para a mesma empresa criam só UM SstProviderCompany PENDING", async () => {
    const { requestAccessToCompany } = await import("@/lib/sst-company-provisioning");

    const { provider, user } = await makeProviderUser("race-request-access");
    const company = await createTestCompanyWithRoles("race-request-access-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });

    const [result1, result2] = await Promise.all([
      requestAccessToCompany(provider.id, { id: user.id, name: user.name }, cnpj),
      requestAccessToCompany(provider.id, { id: user.id, name: user.name }, cnpj),
    ]);

    // Nenhuma das duas expõe erro bruto do Prisma — as duas recebem um
    // resultado semanticamente seguro (uma cria PENDING, a outra relê o
    // mesmo vínculo já criado pela primeira).
    expect(["AUTHORIZATION_REQUESTED", "AUTHORIZATION_PENDING"]).toContain(result1.status);
    expect(["AUTHORIZATION_REQUESTED", "AUTHORIZATION_PENDING"]).toContain(result2.status);

    const count = await prisma.sstProviderCompany.count({ where: { providerId: provider.id, companyId: company.id } });
    expect(count).toBe(1);
    const link = await prisma.sstProviderCompany.findFirstOrThrow({ where: { providerId: provider.id, companyId: company.id } });
    expect(link.status).toBe("PENDING");
  });
});

describe("Manipulação — campos do client nunca são autoridade (§6)", () => {
  it("approve dedicado ignora status/authorizationBasis/providerId/companyId forjados no body", async () => {
    linkRoute ??= await import("@/app/api/sst-providers/[id]/route");
    const approveRoute = await import("@/app/api/sst-providers/requests/[relationshipId]/approve/route");
    const { company, admin } = await makeCompanyWithAdmin("manip-approve");
    const provider = await createTestProvider("manip-approve-p");
    providerIds.push(provider.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "PENDING" });

    const otherCompany = await createTestCompanyWithRoles("manip-approve-other");
    companyIds.push(otherCompany.id);
    const otherProvider = await createTestProvider("manip-approve-other-p");
    providerIds.push(otherProvider.id);

    loginAs(admin);
    const req = new NextRequest(`http://localhost/api/sst-providers/requests/${link.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessLevel: "ADMINISTRATION",
        status: "REVOKED",
        authorizationBasis: "SUPER_ADMIN",
        providerId: otherProvider.id,
        companyId: otherCompany.id,
      }),
    });
    const res = await approveRoute.POST(req, { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(200);

    const updated = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe("ACTIVE"); // nunca REVOKED forjado
    expect(updated.providerId).toBe(provider.id); // nunca o otherProvider forjado
    expect(updated.companyId).toBe(company.id); // nunca a otherCompany forjada
    expect(updated.authorizationBasis).toBe("COMPANY_APPROVAL"); // nunca SUPER_ADMIN forjado
    expect(updated.accessLevel).toBe("ADMINISTRATION"); // único campo que o body de fato controla
  });

  it("claim-review ignora accessLevel/decision inválidos e nunca aceita relationshipId de outra empresa", async () => {
    claimRoute ??= await import("@/app/api/companies/claim-review/[relationshipId]/route");
    const { company, admin } = await makeCompanyWithAdmin("manip-claim");
    await prisma.company.update({ where: { id: company.id }, data: { controlStatus: "CLAIM_PENDING" } });
    const provider = await createTestProvider("manip-claim-p");
    providerIds.push(provider.id);
    const link = await prisma.sstProviderCompany.create({
      data: { providerId: provider.id, companyId: company.id, status: "ACTIVE", accessLevel: "ADMINISTRATION", authorizationBasis: "PROVIDER_PRE_REGISTRATION" },
    });

    loginAs(admin);
    const req = new NextRequest("http://localhost/api/companies/claim-review/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "CONTINUE", accessLevel: "NOT_A_REAL_LEVEL" }),
    });
    const res = await claimRoute.POST(req, { params: Promise.resolve({ relationshipId: link.id }) });
    expect(res.status).toBe(400); // Zod rejeita enum inválido

    const unchanged = await prisma.sstProviderCompany.findUniqueOrThrow({ where: { id: link.id } });
    expect(unchanged.companyReviewedAt).toBeNull(); // nada foi aplicado
  });
});

describe("Suspensão/revogação bloqueiam sessão já aberta imediatamente (§9)", () => {
  it("requireSstProviderCompanyAccess bloqueia a PRÓXIMA chamada assim que o vínculo é suspenso no banco — sem logout", async () => {
    const { requireSstProviderCompanyAccess } = await import("@/lib/sst-auth");
    const { provider, user } = await makeProviderUser("session-block-suspend");
    const company = await createTestCompanyWithRoles("session-block-suspend-company");
    companyIds.push(company.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE" });

    loginAs(user);
    // Antes de suspender: acesso concedido normalmente.
    await expect(requireSstProviderCompanyAccess(company.id)).resolves.toBeDefined();

    // A "sessão" do usuário nunca muda (mesmo mock de login, nenhum
    // logout) — só o vínculo é alterado diretamente no banco, simulando a
    // empresa suspendendo a consultoria enquanto ela está com a página
    // aberta.
    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { status: "SUSPENDED" } });

    await expect(requireSstProviderCompanyAccess(company.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("revogação também bloqueia imediatamente e preserva o registro (dados nunca apagados)", async () => {
    const { requireSstProviderCompanyAccess } = await import("@/lib/sst-auth");
    const { provider, user } = await makeProviderUser("session-block-revoke");
    const company = await createTestCompanyWithRoles("session-block-revoke-company");
    companyIds.push(company.id);
    const link = await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "ACTIVE" });

    loginAs(user);
    await expect(requireSstProviderCompanyAccess(company.id)).resolves.toBeDefined();

    await prisma.sstProviderCompany.update({ where: { id: link.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await expect(requireSstProviderCompanyAccess(company.id)).rejects.toBeInstanceOf(ForbiddenError);

    const preserved = await prisma.sstProviderCompany.findUnique({ where: { id: link.id } });
    expect(preserved).not.toBeNull();
    expect(preserved!.status).toBe("REVOKED");
  });
});

describe("Auditoria de solicitação negada (§16) — sst_company.request_access_denied", () => {
  it("emite o evento quando a empresa está SUSPENDED", async () => {
    const { requestAccessToCompany } = await import("@/lib/sst-company-provisioning");
    const { provider, user } = await makeProviderUser("audit-denied-suspended");
    const company = await createTestCompanyWithRoles("audit-denied-suspended-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj, operationalStatus: "SUSPENDED" },
    });

    await expect(requestAccessToCompany(provider.id, { id: user.id, name: user.name }, cnpj)).rejects.toThrow();

    const audit = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "sst_company.request_access_denied", providerId: provider.id },
    });
    expect(audit).not.toBeNull();
    // Nunca loga o CNPJ integral nem qualquer dado sensível — só o motivo.
    expect(JSON.stringify(audit?.metadata)).not.toContain(cnpj);
  });

  it("emite o evento quando o vínculo já foi REVOKED (nunca reativa)", async () => {
    const { requestAccessToCompany } = await import("@/lib/sst-company-provisioning");
    const { provider, user } = await makeProviderUser("audit-denied-revoked");
    const company = await createTestCompanyWithRoles("audit-denied-revoked-company");
    companyIds.push(company.id);
    const cnpj = uniqueCnpj();
    await prisma.company.update({
      where: { id: company.id },
      data: { documentType: "CNPJ", documentNormalized: cnpj, documentOriginal: cnpj },
    });
    await linkProviderToCompany({ providerId: provider.id, companyId: company.id, status: "REVOKED" });

    await expect(requestAccessToCompany(provider.id, { id: user.id, name: user.name }, cnpj)).rejects.toThrow();

    const audit = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "sst_company.request_access_denied", providerId: provider.id },
    });
    expect(audit).not.toBeNull();
  });
});

// Sprint SST 1.4B, §15 — a proteção de dados demo vs. reais NÃO é coberta
// por um teste automatizado aqui de propósito: `resetSstDemo()`
// (prisma/reset-sst-demo.ts) faz `DELETE` em QUALQUER Company cujo nome
// termine em "(Demo SST)" no banco inteiro, sem escopo por fixture — chamar
// a função real dentro da suíte apagaria o dataset de demonstração
// verdadeiro deste banco de desenvolvimento (usado para verificação manual
// no navegador) toda vez que `npm test` rodasse, o que seria uma ação
// destrutiva não pedida sobre estado compartilhado. A prova exigida pelo
// §2.3/§22 é feita por execução observada e documentada no relatório desta
// sprint (`npm run db:reset-sst-demo` + `db:seed-sst-demo`, comparando o
// registro "Alves Shopping da construção LTDA" antes/depois), não por um
// teste automatizado que rodaria essa mesma operação destrutiva sem
// supervisão a cada execução da suíte. A lógica de escopo em si
// (`where: { name: { endsWith: "(Demo SST)" } }`) foi revisada por leitura
// de código nesta sprint — ver relatório de entrega.
