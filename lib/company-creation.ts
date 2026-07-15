import { Prisma, type CompanyControlStatus, type CompanyOrigin } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ValidationError } from "@/lib/api-errors";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj";

// Sprint SST 1.4A — serviço central de criação de empresa brasileira.
// Consolida a sequência "normalizar CNPJ -> validar -> definir campos
// documentais canônicos -> criar -> tratar corrida (P2002)" que antes
// existia duplicada em app/api/register/route.ts e
// lib/sst-company-provisioning.ts (preRegisterCompany).
//
// Regra central (permanente): um CNPJ válido e normalizado corresponde a
// uma única Company — a constraint única do banco
// (`@@unique([documentType, documentNormalized])`) é sempre a fonte final
// de verdade; este serviço nunca cria uma segunda Company para o mesmo
// CNPJ, mesmo sob corrida concorrente.

export async function findCompanyByCnpj<T extends Pick<Prisma.TransactionClient, "company">>(
  cnpj: string,
  tx: T = prisma as unknown as T,
) {
  if (!isValidCnpj(cnpj)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  return tx.company.findFirst({
    where: { documentType: "CNPJ", documentNormalized: normalizeCnpj(cnpj) },
  });
}

/**
 * Extrai os nomes de coluna envolvidos num P2002 — nesta versão do Prisma
 * (7.x, `@prisma/adapter-pg`) o formato NÃO é o clássico `error.meta.target`
 * (array simples de nomes de campo) documentado pelo query engine binário:
 * é `error.meta.driverAdapterError.cause.constraint.fields`, cada item já
 * entre aspas duplas literais (ex.: `'"documentNormalized"'`), porque vem
 * direto da mensagem de erro do driver `pg`. Confirmado empiricamente
 * disparando um P2002 real contra o Postgres de desenvolvimento — nunca
 * assumir o formato "clássico" sem checar, já que ele não existe aqui.
 */
function extractP2002Fields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;

  if (Array.isArray(meta?.target)) {
    return meta.target.map(String);
  }
  const driverFields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(driverFields)) {
    return driverFields.map((field) => String(field).replace(/^"|"$/g, ""));
  }
  return [];
}

export type CreateCompanyInput = {
  name: string;
  cnpj: string;
  origin: CompanyOrigin;
  /** Só definido quando `origin: SST_PROVIDER` (pré-cadastro pela
   * consultoria) — nunca aceito de um `providerId` arbitrário do client;
   * sempre resolvido da sessão pelo chamador. */
  createdByProviderId?: string;
  /** Default do schema é `CLAIMED` (cadastro público, dono real desde o
   * início). Só o pré-cadastro pela consultoria passa `UNCLAIMED`
   * explicitamente — nunca um valor arbitrário vindo do client. */
  controlStatus?: CompanyControlStatus;
  phone?: string;
};

/**
 * Cria uma `Company` brasileira nova com os campos documentais canônicos
 * (`documentType`, `documentOriginal`, `documentNormalized`, e o legado
 * `document` sincronizado) sempre derivados do CNPJ informado — nunca
 * aceita `documentNormalized`/`documentType` do chamador, nem um
 * `companyId` para "reaproveitar". Roda dentro da transação `tx` recebida
 * quando fornecida (ex.: pré-cadastro, que cria `SstProviderCompany` na
 * mesma transação) ou diretamente no `prisma` singleton caso contrário.
 *
 * Nunca cria uma segunda `Company` para o mesmo CNPJ: se a constraint
 * única do banco rejeitar o INSERT (corrida entre duas requisições
 * concorrentes), a violação vira `ConflictError` semântico — nunca o erro
 * bruto do Prisma (P2002) chega ao chamador ou ao client.
 */
export async function createCompanyWithCanonicalDocument(
  input: CreateCompanyInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (!isValidCnpj(input.cnpj)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new ValidationError("Informe o nome da empresa.");
  }

  const documentNormalized = normalizeCnpj(input.cnpj);
  const documentOriginal = formatCnpj(input.cnpj);

  try {
    return await tx.company.create({
      data: {
        name: trimmedName,
        phone: input.phone,
        document: documentOriginal,
        documentType: "CNPJ",
        documentOriginal,
        documentNormalized,
        origin: input.origin,
        ...(input.controlStatus ? { controlStatus: input.controlStatus } : {}),
        ...(input.createdByProviderId ? { createdByProviderId: input.createdByProviderId } : {}),
      },
    });
  } catch (error) {
    // Sprint SST 1.4B, §13 — `Company` só tem UMA constraint única relevante
    // além de `id` (`@@unique([documentType, documentNormalized])`); mesmo
    // assim, nunca converte um P2002 "no escuro": confere os campos do
    // erro antes de tratá-lo como CNPJ duplicado, para que uma futura
    // constraint única não seja incorretamente relatada ao chamador como
    // "CNPJ já cadastrado".
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const fields = extractP2002Fields(error);
      if (fields.includes("documentNormalized")) {
        throw new ConflictError("Já existe uma empresa cadastrada com este CNPJ.");
      }
    }
    throw error;
  }
}
