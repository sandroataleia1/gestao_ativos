import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/tests/helpers/db";
import { formatCnpj, normalizeCnpj, withValidCheckDigits } from "@/lib/cnpj";

// Sprint Comercial SST 1.4, §7/§20 — CNPJ obrigatório no cadastro público,
// nunca cria uma segunda Company para o mesmo CNPJ, e mensagem exata quando
// o CNPJ já pertence a uma empresa UNCLAIMED (pré-cadastrada por uma
// consultoria SST). Mesmo padrão de rota direta de
// register-creates-membership.test.ts — sem mock de @/lib/auth.

const createdCompanyIds: string[] = [];
const createdUserEmails: string[] = [];
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
    await prisma.companyMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (createdCompanyIds.length > 0) {
    await prisma.role.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetStatus.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.assetCondition.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.location.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.locationType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.movementType.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
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

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdCompanyIds.push(user.companyId);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
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
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdCompanyIds.push(user.companyId);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
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
    const user1 = await prisma.user.findUniqueOrThrow({ where: { email: email1 } });
    createdCompanyIds.push(user1.companyId);

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

  it("mensagem exata quando o CNPJ já pertence a uma empresa UNCLAIMED (pré-cadastro de consultoria)", async () => {
    const route = await import("@/app/api/register/route");
    const cnpj = uniqueTestCnpj();

    const preRegistered = await prisma.company.create({
      data: {
        name: "__tenant_test__ Empresa Pre-cadastrada",
        document: formatCnpj(cnpj),
        documentType: "CNPJ",
        documentOriginal: formatCnpj(cnpj),
        documentNormalized: cnpj,
        controlStatus: "UNCLAIMED",
        origin: "SST_PROVIDER",
      },
    });
    createdCompanyIds.push(preRegistered.id);

    const email = `__tenant_test__cnpj-unclaimed-${Date.now()}@example.test`;
    const res = await route.POST(
      registerRequest({
        companyName: "__tenant_test__ Tentativa Sobre Empresa Precadastrada",
        cnpj: formatCnpj(cnpj),
        name: "Admin",
        email,
        password: "RegisterTest@12345",
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "Esta empresa já possui um pré-cadastro. O acesso empresarial deverá ser solicitado pelo fluxo de reivindicação.",
    );
    const exists = await prisma.user.findUnique({ where: { email } });
    expect(exists).toBeNull();

    // Nunca revela dados internos da empresa encontrada (nome, id, etc.).
    expect(JSON.stringify(body)).not.toContain(preRegistered.id);
    expect(JSON.stringify(body)).not.toContain("Pre-cadastrada");
  });
});
