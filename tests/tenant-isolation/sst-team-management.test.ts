import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  cleanupFixtures,
  createProviderUser,
  createTestCompany,
  createTestProvider,
  createTestUser,
  prisma,
  toSessionUser,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";

// Sprint Demo Comercial SST 1.0, Parte 13 — 14 testes de gestão da equipe da
// consultoria (app/api/sst/team/**, lib/sst-team.ts). Mesmo padrão de mock de
// sessão dos demais testes de tenant-isolation (loginAs troca o usuário
// "logado" entre casos, sem precisar de um servidor HTTP real).

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}

let teamRoute: typeof import("@/app/api/sst/team/route");
let memberRoute: typeof import("@/app/api/sst/team/[memberId]/route");
let deactivateRoute: typeof import("@/app/api/sst/team/[memberId]/deactivate/route");
let reactivateRoute: typeof import("@/app/api/sst/team/[memberId]/reactivate/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

beforeAll(async () => {
  teamRoute = await import("@/app/api/sst/team/route");
  memberRoute = await import("@/app/api/sst/team/[memberId]/route");
  deactivateRoute = await import("@/app/api/sst/team/[memberId]/deactivate/route");
  reactivateRoute = await import("@/app/api/sst/team/[memberId]/reactivate/route");
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

/** Cria um User global + o vínculo SstProviderUser pedido — companyId é só
 * a FK legada NOT NULL de User, irrelevante para o Portal Consultoria. */
async function makeProviderUser(
  providerId: string,
  label: string,
  role: "OWNER" | "TECHNICIAN" | "VIEWER",
  active = true,
) {
  const anchorCompany = await createTestCompany(`${label}-anchor`);
  companyIds.push(anchorCompany.id);
  const raw = await createTestUser(anchorCompany.id, label);
  await createProviderUser({ providerId, userId: raw.id, role });
  if (!active) {
    await prisma.sstProviderUser.update({ where: { providerId_userId: { providerId, userId: raw.id } }, data: { active: false } });
  }
  return toSessionUser(raw);
}

function getRequest() {
  return new NextRequest("http://localhost/api/sst/team");
}
function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sst/team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/sst/team/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function postNoBody() {
  return new NextRequest("http://localhost/api/sst/team/x/action", { method: "POST" });
}

const GENERIC_RESPONSE = {
  message: "Caso exista uma conta elegível para esse endereço, o acesso ficará disponível para o usuário.",
};

describe("Sprint Demo Comercial SST 1.0, Parte 13 — gestão da equipe da consultoria", () => {
  it("caso 1: OWNER lista os usuários da própria consultoria, com e-mail incluído", async () => {
    const provider = await makeProvider("team-list-owner");
    const owner = await makeProviderUser(provider.id, "team-list-owner-u", "OWNER");
    const tech = await makeProviderUser(provider.id, "team-list-owner-tech", "TECHNICIAN");

    loginAs(owner);
    const res = await teamRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2);
    const techRow = body.members.find((m: { userId: string }) => m.userId === tech.id);
    expect(techRow.email).toBe(tech.email);
  });

  it("caso 1b: TECHNICIAN/VIEWER veem a lista mas sem e-mail dos colegas", async () => {
    const provider = await makeProvider("team-list-noemail");
    const owner = await makeProviderUser(provider.id, "team-list-noemail-owner", "OWNER");
    const viewer = await makeProviderUser(provider.id, "team-list-noemail-viewer", "VIEWER");

    loginAs(viewer);
    const res = await teamRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ownerRow = body.members.find((m: { userId: string }) => m.userId === owner.id);
    expect(ownerRow.email).toBeNull();
  });

  it("caso 2: TECHNICIAN não gerencia equipe (POST bloqueado)", async () => {
    const provider = await makeProvider("team-tech-no-manage");
    const tech = await makeProviderUser(provider.id, "team-tech-no-manage-u", "TECHNICIAN");
    const target = await createTestUser((await createTestCompany("team-tech-target-co")).id, "team-tech-target");
    companyIds.push(target.companyId);

    loginAs(tech);
    const res = await teamRoute.POST(postRequest({ email: target.email, role: "VIEWER" }));
    expect(res.status).toBe(403);
  });

  it("caso 2b: VIEWER não gerencia equipe (POST bloqueado)", async () => {
    const provider = await makeProvider("team-viewer-no-manage");
    const viewer = await makeProviderUser(provider.id, "team-viewer-no-manage-u", "VIEWER");
    const target = await createTestUser((await createTestCompany("team-viewer-target-co")).id, "team-viewer-target");
    companyIds.push(target.companyId);

    loginAs(viewer);
    const res = await teamRoute.POST(postRequest({ email: target.email, role: "VIEWER" }));
    expect(res.status).toBe(403);
  });

  it("caso 3: providerId manipulado no body é ignorado — vínculo criado sempre no provider da sessão do ator", async () => {
    const providerA = await makeProvider("team-body-a");
    const providerB = await makeProvider("team-body-b");
    const ownerA = await makeProviderUser(providerA.id, "team-body-a-owner", "OWNER");
    const target = await createTestUser((await createTestCompany("team-body-target-co")).id, "team-body-target");
    companyIds.push(target.companyId);

    loginAs(ownerA);
    // Corpo malicioso tentando injetar um providerId de outra consultoria —
    // a rota nunca lê esse campo (deriva sempre de requireSstRole()).
    const res = await teamRoute.POST(postRequest({ email: target.email, role: "VIEWER", providerId: providerB.id }));
    expect(res.status).toBe(200);

    const linkInA = await prisma.sstProviderUser.findUnique({
      where: { providerId_userId: { providerId: providerA.id, userId: target.id } },
    });
    const linkInB = await prisma.sstProviderUser.findUnique({
      where: { providerId_userId: { providerId: providerB.id, userId: target.id } },
    });
    expect(linkInA).not.toBeNull();
    expect(linkInB).toBeNull();
  });

  it("caso 4: usuário de outra consultoria não aparece na listagem", async () => {
    const providerA = await makeProvider("team-cross-a");
    const providerB = await makeProvider("team-cross-b");
    const ownerA = await makeProviderUser(providerA.id, "team-cross-a-owner", "OWNER");
    const userB = await makeProviderUser(providerB.id, "team-cross-b-user", "OWNER");

    loginAs(ownerA);
    const res = await teamRoute.GET();
    const body = await res.json();
    const ids = body.members.map((m: { userId: string }) => m.userId);
    expect(ids).not.toContain(userB.id);
  });

  it("caso 5: adicionar usuário existente cria SstProviderUser ACTIVE com o papel pedido", async () => {
    const provider = await makeProvider("team-add-happy");
    const owner = await makeProviderUser(provider.id, "team-add-happy-owner", "OWNER");
    const target = await createTestUser((await createTestCompany("team-add-happy-target-co")).id, "team-add-happy-target");
    companyIds.push(target.companyId);

    loginAs(owner);
    const res = await teamRoute.POST(postRequest({ email: target.email, role: "TECHNICIAN" }));
    expect(res.status).toBe(200);

    const link = await prisma.sstProviderUser.findUnique({
      where: { providerId_userId: { providerId: provider.id, userId: target.id } },
    });
    expect(link?.role).toBe("TECHNICIAN");
    expect(link?.active).toBe(true);
  });

  it("caso 6: resposta é externamente idêntica para e-mail inexistente e existente", async () => {
    const provider = await makeProvider("team-enum");
    const owner = await makeProviderUser(provider.id, "team-enum-owner", "OWNER");
    const existingTarget = await createTestUser((await createTestCompany("team-enum-target-co")).id, "team-enum-target");
    companyIds.push(existingTarget.companyId);

    loginAs(owner);
    const resMissing = await teamRoute.POST(postRequest({ email: `nao-existe-${Date.now()}@example.test`, role: "VIEWER" }));
    const resExisting = await teamRoute.POST(postRequest({ email: existingTarget.email, role: "VIEWER" }));

    expect(resMissing.status).toBe(resExisting.status);
    const bodyMissing = await resMissing.json();
    const bodyExisting = await resExisting.json();
    expect(bodyMissing).toEqual(GENERIC_RESPONSE);
    expect(bodyExisting).toEqual(GENERIC_RESPONSE);
  });

  it("caso 7: adicionar o mesmo usuário duas vezes não duplica o vínculo", async () => {
    const provider = await makeProvider("team-dup");
    const owner = await makeProviderUser(provider.id, "team-dup-owner", "OWNER");
    const target = await createTestUser((await createTestCompany("team-dup-target-co")).id, "team-dup-target");
    companyIds.push(target.companyId);

    loginAs(owner);
    await teamRoute.POST(postRequest({ email: target.email, role: "VIEWER" }));
    const res2 = await teamRoute.POST(postRequest({ email: target.email, role: "TECHNICIAN" }));
    expect(res2.status).toBe(200);

    const links = await prisma.sstProviderUser.findMany({ where: { providerId: provider.id, userId: target.id } });
    expect(links).toHaveLength(1);
    // Segunda chamada foi tratada como "já é membro" — não promove/altera o papel.
    expect(links[0].role).toBe("VIEWER");
  });

  it("caso 8: alteração de papel exige OWNER (TECHNICIAN bloqueado)", async () => {
    const provider = await makeProvider("team-role-needs-owner");
    const tech = await makeProviderUser(provider.id, "team-role-needs-owner-tech", "TECHNICIAN");
    const viewer = await makeProviderUser(provider.id, "team-role-needs-owner-viewer", "VIEWER");
    const viewerMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: viewer.id } });

    loginAs(tech);
    const res = await memberRoute.PATCH(patchRequest({ role: "OWNER" }), {
      params: Promise.resolve({ memberId: viewerMember.id }),
    });
    expect(res.status).toBe(403);
  });

  it("caso 9: papel fora do enum é rejeitado (400)", async () => {
    const provider = await makeProvider("team-role-invalid");
    const owner = await makeProviderUser(provider.id, "team-role-invalid-owner", "OWNER");
    const viewer = await makeProviderUser(provider.id, "team-role-invalid-viewer", "VIEWER");
    const viewerMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: viewer.id } });

    loginAs(owner);
    const res = await memberRoute.PATCH(patchRequest({ role: "SUPERADMIN" }), {
      params: Promise.resolve({ memberId: viewerMember.id }),
    });
    expect(res.status).toBe(400);

    const fresh = await prisma.sstProviderUser.findUniqueOrThrow({ where: { id: viewerMember.id } });
    expect(fresh.role).toBe("VIEWER");
  });

  it("caso 10: último OWNER ativo não pode ser rebaixado", async () => {
    const provider = await makeProvider("team-last-owner-demote");
    const owner = await makeProviderUser(provider.id, "team-last-owner-demote-owner", "OWNER");
    const ownerMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: owner.id } });

    loginAs(owner);
    const res = await memberRoute.PATCH(patchRequest({ role: "TECHNICIAN" }), {
      params: Promise.resolve({ memberId: ownerMember.id }),
    });
    expect(res.status).toBe(409);

    const fresh = await prisma.sstProviderUser.findUniqueOrThrow({ where: { id: ownerMember.id } });
    expect(fresh.role).toBe("OWNER");
  });

  it("caso 11: último OWNER ativo não pode ser desativado", async () => {
    const provider = await makeProvider("team-last-owner-deactivate");
    const owner = await makeProviderUser(provider.id, "team-last-owner-deactivate-owner", "OWNER");
    const ownerMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: owner.id } });

    loginAs(owner);
    const res = await deactivateRoute.POST(postNoBody(), { params: Promise.resolve({ memberId: ownerMember.id }) });
    expect(res.status).toBe(409);

    const fresh = await prisma.sstProviderUser.findUniqueOrThrow({ where: { id: ownerMember.id } });
    expect(fresh.active).toBe(true);
  });

  it("caso 12: usuário desativado perde acesso imediatamente, mesmo com sessão Better Auth ainda ativa", async () => {
    const provider = await makeProvider("team-deactivate-session");
    const owner = await makeProviderUser(provider.id, "team-deactivate-session-owner", "OWNER");
    const tech = await makeProviderUser(provider.id, "team-deactivate-session-tech", "TECHNICIAN");
    const techMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: tech.id } });

    // A "sessão" do técnico já está em memória (loginAs troca só o mock de
    // getSession — equivalente a um cookie de sessão Better Auth ainda
    // válido) quando o OWNER o desativa.
    loginAs(owner);
    const deactivateRes = await deactivateRoute.POST(postNoBody(), { params: Promise.resolve({ memberId: techMember.id }) });
    expect(deactivateRes.status).toBe(200);

    // Próxima requisição autenticada do técnico (mesma sessão, sem logout).
    loginAs(tech);
    const res = await teamRoute.GET();
    expect(res.status).toBe(403);
  });

  it("caso 13: outro OWNER pode reativar um usuário desativado", async () => {
    const provider = await makeProvider("team-reactivate");
    const owner = await makeProviderUser(provider.id, "team-reactivate-owner", "OWNER");
    const tech = await makeProviderUser(provider.id, "team-reactivate-tech", "TECHNICIAN", false);
    const techMember = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: provider.id, userId: tech.id } });
    expect(techMember.active).toBe(false);

    loginAs(owner);
    const res = await reactivateRoute.POST(postNoBody(), { params: Promise.resolve({ memberId: techMember.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.sstProviderUser.findUniqueOrThrow({ where: { id: techMember.id } });
    expect(fresh.active).toBe(true);
  });

  it("caso 14: SstProviderUser de uma consultoria não concede acesso à equipe de outra (memberId cross-provider vira 404)", async () => {
    const providerA = await makeProvider("team-cross-member-a");
    const providerB = await makeProvider("team-cross-member-b");
    const ownerA = await makeProviderUser(providerA.id, "team-cross-member-a-owner", "OWNER");
    const userB = await makeProviderUser(providerB.id, "team-cross-member-b-user", "VIEWER");
    const memberB = await prisma.sstProviderUser.findFirstOrThrow({ where: { providerId: providerB.id, userId: userB.id } });

    loginAs(ownerA);
    const res = await memberRoute.PATCH(patchRequest({ role: "TECHNICIAN" }), {
      params: Promise.resolve({ memberId: memberB.id }),
    });
    expect(res.status).toBe(404);

    const fresh = await prisma.sstProviderUser.findUniqueOrThrow({ where: { id: memberB.id } });
    expect(fresh.role).toBe("VIEWER");
  });
});
