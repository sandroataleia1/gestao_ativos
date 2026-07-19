import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ValidationError } from "@/lib/api-errors";
import { formatCnpj, isValidCnpj } from "@/lib/cnpj";

// Cadastro público de consultoria (app/sst/register) — espelha
// lib/company-creation.ts (mesma sequência: normalizar CNPJ -> validar ->
// criar -> tratar corrida via P2002), adaptado para SstProvider. Diferença
// central: SstProvider.document é um campo único (não o par
// documentType/documentNormalized de Company) porque, por ora, só CNPJ é
// aceito aqui — sem necessidade da riqueza de tipos de documento que
// Company já suporta.

/**
 * Extrai os nomes de coluna envolvidos num P2002 — mesmo formato de
 * lib/company-creation.ts (Prisma 7.x/@prisma/adapter-pg): o campo vem de
 * `error.meta.driverAdapterError.cause.constraint.fields`, não do formato
 * clássico `error.meta.target`.
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

export async function findSstProviderByDocument(cnpj: string) {
  if (!isValidCnpj(cnpj)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  return prisma.sstProvider.findFirst({ where: { document: formatCnpj(cnpj) } });
}

export type CreateSstProviderInput = {
  name: string;
  cnpj: string;
  email?: string;
  phone?: string;
};

/**
 * Cria uma `SstProvider` nova a partir do cadastro público — nunca
 * reaproveita uma linha existente (diferente do fluxo de reivindicação de
 * `Company`: aqui não há conceito de "pré-cadastro por terceiro" a
 * reivindicar, então um CNPJ já cadastrado é sempre um conflito).
 * `document` é sempre o CNPJ formatado (`formatCnpj`) — nunca aceita
 * `document` bruto do chamador. A constraint única do banco
 * (`SstProvider_document_key`) é a fonte final de verdade contra corrida
 * (duas requisições de registro simultâneas com o mesmo CNPJ): a violação
 * vira `ConflictError` semântico, nunca o P2002 bruto.
 */
export async function createSstProviderWithCanonicalDocument(input: CreateSstProviderInput) {
  if (!isValidCnpj(input.cnpj)) {
    throw new ValidationError("Informe um CNPJ válido.");
  }
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new ValidationError("Informe o nome da consultoria.");
  }

  const document = formatCnpj(input.cnpj);

  try {
    return await prisma.sstProvider.create({
      data: {
        name: trimmedName,
        document,
        email: input.email,
        phone: input.phone,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const fields = extractP2002Fields(error);
      if (fields.includes("document")) {
        throw new ConflictError("Já existe uma consultoria cadastrada com este CNPJ.");
      }
    }
    throw error;
  }
}
