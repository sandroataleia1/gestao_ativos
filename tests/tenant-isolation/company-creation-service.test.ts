import { afterAll, describe, expect, it } from "vitest";

import { cleanupFixtures, createTestProvider, prisma } from "@/tests/helpers/db";
import { createCompanyWithCanonicalDocument, findCompanyByCnpj } from "@/lib/company-creation";
import { ConflictError, ValidationError } from "@/lib/api-errors";
import { formatCnpj, withValidCheckDigits } from "@/lib/cnpj";

// Sprint SST 1.4A, §14/§21 — serviço central de criação de empresa
// brasileira (lib/company-creation.ts), usado por app/api/register/route.ts
// e lib/sst-company-provisioning.ts (preRegisterCompany). Testado
// diretamente aqui (sem passar pela camada HTTP) para cobrir o contrato do
// serviço em si: nunca aceita documentNormalized do caller, nunca cria duas
// Company para o mesmo CNPJ mesmo sob corrida real.

const companyIds: string[] = [];
const providerIds: string[] = [];
let seq = 0;

function uniqueCnpj(): string {
  seq += 1;
  const base = `${Date.now()}${seq}`.slice(-12).padStart(12, "0");
  return withValidCheckDigits(base);
}

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

describe("createCompanyWithCanonicalDocument", () => {
  it("cria a empresa com os campos documentais canônicos derivados do CNPJ", async () => {
    const cnpj = uniqueCnpj();
    const company = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Servico Central",
      cnpj: formatCnpj(cnpj),
      origin: "SELF_REGISTRATION",
    });
    companyIds.push(company.id);

    expect(company.documentType).toBe("CNPJ");
    expect(company.documentNormalized).toBe(cnpj);
    expect(company.documentOriginal).toBe(formatCnpj(cnpj));
    expect(company.document).toBe(formatCnpj(cnpj)); // legado sincronizado
    expect(company.origin).toBe("SELF_REGISTRATION");
    expect(company.controlStatus).toBe("CLAIMED"); // default do schema
  });

  it("aceita CNPJ sem máscara e normaliza igual a com máscara", async () => {
    const cnpj = uniqueCnpj();
    const company = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Sem Mascara",
      cnpj, // sem máscara
      origin: "SELF_REGISTRATION",
    });
    companyIds.push(company.id);
    expect(company.documentNormalized).toBe(cnpj);
    expect(company.documentOriginal).toBe(formatCnpj(cnpj));
  });

  it("respeita controlStatus/createdByProviderId quando informados explicitamente (contrato do pré-cadastro)", async () => {
    const provider = await createTestProvider("company-creation-svc");
    providerIds.push(provider.id);
    const cnpj = uniqueCnpj();
    const company = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Provisoria",
      cnpj,
      origin: "SST_PROVIDER",
      controlStatus: "UNCLAIMED",
      createdByProviderId: provider.id,
    });
    companyIds.push(company.id);
    expect(company.controlStatus).toBe("UNCLAIMED");
    expect(company.createdByProviderId).toBe(provider.id);
    expect(company.origin).toBe("SST_PROVIDER");
  });

  it("rejeita CNPJ inválido com ValidationError amigável (nunca erro bruto do Prisma)", async () => {
    await expect(
      createCompanyWithCanonicalDocument({ name: "__tenant_test__ X", cnpj: "11.111.111/1111-11", origin: "SELF_REGISTRATION" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejeita nome vazio", async () => {
    const cnpj = uniqueCnpj();
    await expect(
      createCompanyWithCanonicalDocument({ name: "   ", cnpj, origin: "SELF_REGISTRATION" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("CNPJ duplicado nunca cria uma segunda Company — ConflictError amigável, nunca P2002 bruto", async () => {
    const cnpj = uniqueCnpj();
    const first = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Original",
      cnpj,
      origin: "SELF_REGISTRATION",
    });
    companyIds.push(first.id);

    await expect(
      createCompanyWithCanonicalDocument({ name: "__tenant_test__ Empresa Duplicada", cnpj, origin: "SELF_REGISTRATION" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const count = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(count).toBe(1);
  });

  it("máscara diferente do mesmo CNPJ ainda é bloqueada pela unicidade (identidade não muda com formatação)", async () => {
    const cnpj = uniqueCnpj();
    const first = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Mascarada",
      cnpj: formatCnpj(cnpj),
      origin: "SELF_REGISTRATION",
    });
    companyIds.push(first.id);

    await expect(
      createCompanyWithCanonicalDocument({ name: "__tenant_test__ Empresa Sem Mascara Dup", cnpj, origin: "SELF_REGISTRATION" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("concorrência real: duas requisições simultâneas com o mesmo CNPJ criam só uma Company", async () => {
    const cnpj = uniqueCnpj();
    const results = await Promise.allSettled([
      createCompanyWithCanonicalDocument({ name: "__tenant_test__ Corrida 1", cnpj, origin: "SELF_REGISTRATION" }),
      createCompanyWithCanonicalDocument({ name: "__tenant_test__ Corrida 2", cnpj, origin: "SELF_REGISTRATION" }),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createCompanyWithCanonicalDocument>>> => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      // Mensagem amigável, nunca "P2002"/"Unique constraint failed" cru.
      expect(String(rejected[0].reason.message)).not.toMatch(/P2002|Unique constraint/i);
    }

    companyIds.push(fulfilled[0].value.id);

    const count = await prisma.company.count({ where: { documentNormalized: cnpj } });
    expect(count).toBe(1);
  });
});

describe("findCompanyByCnpj", () => {
  it("encontra a empresa independente de máscara na consulta", async () => {
    const cnpj = uniqueCnpj();
    const created = await createCompanyWithCanonicalDocument({
      name: "__tenant_test__ Empresa Busca",
      cnpj,
      origin: "SELF_REGISTRATION",
    });
    companyIds.push(created.id);

    const foundMasked = await findCompanyByCnpj(formatCnpj(cnpj));
    const foundUnmasked = await findCompanyByCnpj(cnpj);
    expect(foundMasked?.id).toBe(created.id);
    expect(foundUnmasked?.id).toBe(created.id);
  });

  it("devolve null quando não existe", async () => {
    const cnpj = uniqueCnpj();
    expect(await findCompanyByCnpj(cnpj)).toBeNull();
  });

  it("rejeita CNPJ inválido com ValidationError", async () => {
    await expect(findCompanyByCnpj("123")).rejects.toBeInstanceOf(ValidationError);
  });
});
