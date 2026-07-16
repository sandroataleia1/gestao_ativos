import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";
import { formatCnpj, withValidCheckDigits } from "@/lib/cnpj";

// Sprint Comercial SST 1.4, §7/§20 — CNPJ obrigatório no cadastro público,
// nunca cria uma segunda Company para o mesmo CNPJ, e mensagem exata quando
// o CNPJ já pertence a uma empresa UNCLAIMED (pré-cadastrada por uma
// consultoria SST). Mesmo padrão de rota direta de
// register-creates-membership.test.ts — sem mock de @/lib/auth.

const createdCompanyIds: string[] = [];
const createdUserEmails: string[] = [];
const createdProviderIds: string[] = [];
let seq = 0;

function uniqueTestCnpj(): string {
  seq += 1;
  const base = `${Date.now()}${seq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: createdUserEmails } } });
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    // CompanyClaimRequest.requesterUserId usa onDelete: Restrict (Sprint SST
    // 1.4C) — precisa sair antes do User, senão o DELETE falha com FK.
    await prisma.companyClaimRequest.deleteMany({ where: { requesterUserId: { in: userIds } } });
    await prisma.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (createdCompanyIds.length > 0) {
    // Notification.companyId/sstProviderId usam onDelete: Restrict (Sprint
    // SST 1.4E) — precisa sair antes de Company/SstProvider, senão o
    // DELETE falha com violação de FK (ex.: SST_COMPANY_CLAIM_STARTED
    // criada pelo teste de reivindicação sobre pré-cadastro abaixo).
    await prisma.notification.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.sstProviderCompany.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.role.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetStatus.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetCondition.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.location.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.locationType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.movementType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  }
  if (createdProviderIds.length > 0) {
    await prisma.notification.deleteMany({ where: { sstProviderId: { in: createdProviderIds } } });
    await prisma.sstProvider.deleteMany({ where: { id: { in: createdProviderIds } } });
  }
  await prisma.$disconnect();
});

function registerRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/register — CNPJ obrigatório (Sprint Comercial SST 1.4)", () => {
  it("rejeita registro sem CNPJ", async () => {
    const route = await import("@/app/api/register/route");
    const email = `__tenant_test__cnpj-missing-${Date.now()}@example.test`;
    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa Sem CNPJ",
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(400);
    const exists = await prisma.user.findUnique({ where: { email } });
    expect(exists).toBeNull();
  });

  it("rejeita CNPJ com dígito verificador inválido", async () => {
    const route = await import("@/app/api/register/route");
    const email = `__tenant_test__cnpj-invalid-${Date.now()}@example.test`;
    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa CNPJ Invalido",
        cnpj: "11.111.111/1111-11",
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("cria a empresa com documentType/documentOriginal/documentNormalized preenchidos", async () => {
    const route = await import("@/app/api/register/route");
    const email = `__tenant_test__cnpj-ok-${Date.now()}@example.test`;
    createdUserEmails.push(email);
    const cnpj = uniqueTestCnpj();

    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa CNPJ Valido",
        cnpj: formatCnpj(cnpj),
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(200);

    // Sprint SST 1.4C.1 — User.companyId não é mais preenchido no registro
    // (só na aprovação); a Company recém-criada é encontrada pelo CNPJ.
    const company = await prisma.company.findFirstOrThrow({ where: { documentNormalized: cnpj } });
    createdCompanyIds.push(company.id);
    expect(company.documentType).toBe("CNPJ");
    expect(company.documentNormalized).toBe(cnpj);
    expect(company.documentOriginal).toBe(formatCnpj(cnpj));
  });

  it("aceita CNPJ digitado sem máscara e normaliza igual", async () => {
    const route = await import("@/app/api/register/route");
    const email = `__tenant_test__cnpj-nomask-${Date.now()}@example.test`;
    createdUserEmails.push(email);
    const cnpj = uniqueTestCnpj();

    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa CNPJ Sem Mascara",
        cnpj,
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(200);
    const company = await prisma.company.findFirstOrThrow({ where: { documentNormalized: cnpj } });
    createdCompanyIds.push(company.id);
    expect(company.documentNormalized).toBe(cnpj);
  });

  it("nunca cria uma segunda empresa para o mesmo CNPJ (empresa já CLAIMED)", async () => {
    const route = await import("@/app/api/register/route");
    const cnpj = uniqueTestCnpj();

    const email1 = `__tenant_test__cnpj-dup1-${Date.now()}@example.test`;
    createdUserEmails.push(email1);
    const res1 = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa Original",
        cnpj: formatCnpj(cnpj),
        name: "Admin 1",
        email: email1,
        password: "RegisterTest@12345",
      }),
    );
    expect(res1.status).toBe(200);
    const company1 = await prisma.company.findFirstOrThrow({ where: { documentNormalized: cnpj } });
    createdCompanyIds.push(company1.id);

    const companiesBefore = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(companiesBefore).toBe(1);

    const email2 = `__tenant_test__cnpj-dup2-${Date.now()}@example.test`;
    const res2 = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Empresa Duplicada",
        cnpj: formatCnpj(cnpj),
        name: "Admin 2",
        email: email2,
        password: "RegisterTest@12345",
      }),
    );
    expect(res2.status).toBe(409);
    const body = (await res2.json()) as { error: string };
    expect(body.error).not.toMatch(/pré-cadastro/);
    const exists = await prisma.user.findUnique({ where: { email: email2 } });
    expect(exists).toBeNull();

    const companiesAfter = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(companiesAfter).toBe(1);
  });

  it("CNPJ de empresa UNCLAIMED com vínculo provisório -> reivindica (200), fica CLAIM_PENDING, nunca duplica a Company", async () => {
    const route = await import("@/app/api/register/route");
    const cnpj = uniqueTestCnpj();

    const provider = await prisma.sstProvider.create({
      data: { name: "__tenant_test__ Consultoria Reivindicacao", active: true },
    });
    createdProviderIds.push(provider.id);

    const preRegistered = await prisma.company.create({
      data: {
        name: "__tenant_test__ Empresa Pre-cadastrada",
        document: formatCnpj(cnpj),
        documentType: "CNPJ",
        documentOriginal: formatCnpj(cnpj),
        documentNormalized: cnpj,
        controlStatus: "UNCLAIMED",
        origin: "SST_PROVIDER",
        createdByProviderId: provider.id,
      },
    });
    createdCompanyIds.push(preRegistered.id);
    await prisma.sstProviderCompany.create({
      data: {
        providerId: provider.id,
        companyId: preRegistered.id,
        status: "ACTIVE",
        accessLevel: "ADMINISTRATION",
        authorizationBasis: "PROVIDER_PRE_REGISTRATION",
      },
    });

    const email = `__tenant_test__cnpj-unclaimed-${Date.now()}@example.test`;
    createdUserEmails.push(email);
    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Tentativa Sobre Empresa Precadastrada",
        cnpj: formatCnpj(cnpj),
        name: "Admin Reivindicante",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    // Sprint SST 1.4C — nunca mais concede acesso automático a partir do
    // CNPJ; a resposta agora é sempre CLAIM_REVIEW_REQUIRED, e nenhuma
    // CompanyMembership é criada aqui (só uma CompanyClaimRequest PENDING).
    expect(body.status).toBe("CLAIM_REVIEW_REQUIRED");

    // Nunca cria uma segunda Company — o usuário é criado sobre a MESMA empresa.
    const companiesWithCnpj = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(companiesWithCnpj).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    // Sprint SST 1.4C.1, §4 — User.companyId permanece null até a
    // aprovação; nunca aponta prematuramente para a empresa reivindicada.
    expect(user.companyId).toBeNull();

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: preRegistered.id } },
    });
    expect(membership).toBeNull();

    const claim = await prisma.companyClaimRequest.findUniqueOrThrow({
      where: { companyId_requesterUserId: { companyId: preRegistered.id, requesterUserId: user.id } },
    });
    expect(claim.status).toBe("PENDING");
    expect(claim.origin).toBe("EXISTING_PRE_REGISTRATION");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: preRegistered.id } });
    expect(company.controlStatus).toBe("CLAIM_PENDING");
    expect(company.claimedAt).toBeNull();
    // O nome pré-cadastrado pela consultoria nunca é sobrescrito pelo nome
    // informado no formulário de registro.
    expect(company.name).toBe("__tenant_test__ Empresa Pre-cadastrada");

    const link = await prisma.sstProviderCompany.findUniqueOrThrow({
      where: { providerId_companyId: { providerId: provider.id, companyId: preRegistered.id } },
    });
    expect(link.status).toBe("ACTIVE");
    expect(link.authorizationBasis).toBe("PROVIDER_PRE_REGISTRATION");
    expect(link.companyReviewedAt).toBeNull(); // ainda não decidido
  });

  it("nunca cria uma segunda empresa para o mesmo CNPJ (empresa CLAIM_PENDING/CLAIMED por outra reivindicação)", async () => {
    const route = await import("@/app/api/register/route");
    const cnpj = uniqueTestCnpj();

    const claimPendingCompany = await prisma.company.create({
      data: {
        name: "__tenant_test__ Empresa Ja Reivindicando",
        document: formatCnpj(cnpj),
        documentType: "CNPJ",
        documentOriginal: formatCnpj(cnpj),
        documentNormalized: cnpj,
        controlStatus: "CLAIM_PENDING",
      },
    });
    createdCompanyIds.push(claimPendingCompany.id);

    const email = `__tenant_test__cnpj-claimpending-${Date.now()}@example.test`;
    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Segunda Tentativa",
        cnpj: formatCnpj(cnpj),
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Já existe uma empresa cadastrada com este CNPJ.");
    const exists = await prisma.user.findUnique({ where: { email } });
    expect(exists).toBeNull();

    // Nunca revela dados internos da empresa encontrada (nome, id, etc.).
    expect(JSON.stringify(body)).not.toContain(claimPendingCompany.id);
    expect(JSON.stringify(body)).not.toContain("Ja Reivindicando");

    const companiesAfter = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(companiesAfter).toBe(1);
  });
});
