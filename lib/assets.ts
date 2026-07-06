import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import type { AssetInput } from "@/lib/validations/asset";

/**
 * Garante que category/manufacturer/supplier/status/condition (quando
 * informados) existem e pertencem à empresa atual — nunca confia apenas no
 * formato do id vindo do client.
 */
export async function assertAssetReferencesBelongToCompany(
  companyId: string,
  input: Pick<
    AssetInput,
    "categoryId" | "manufacturerId" | "supplierId" | "statusId" | "conditionId"
  >,
) {
  const category = await prisma.assetCategory.findFirst({
    where: { id: input.categoryId, companyId },
    select: { id: true },
  });
  if (!category) throw new ValidationError("Categoria inválida.");

  const status = await prisma.assetStatus.findFirst({
    where: { id: input.statusId, companyId },
    select: { id: true },
  });
  if (!status) throw new ValidationError("Status inválido.");

  const condition = await prisma.assetCondition.findFirst({
    where: { id: input.conditionId, companyId },
    select: { id: true },
  });
  if (!condition) throw new ValidationError("Condição inválida.");

  if (input.manufacturerId) {
    const manufacturer = await prisma.manufacturer.findFirst({
      where: { id: input.manufacturerId, companyId },
      select: { id: true },
    });
    if (!manufacturer) throw new ValidationError("Fabricante inválido.");
  }

  if (input.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: input.supplierId, companyId },
      select: { id: true },
    });
    if (!supplier) throw new ValidationError("Fornecedor inválido.");
  }
}

export const assetListInclude = {
  category: { select: { id: true, name: true } },
  manufacturer: { select: { id: true, name: true } },
  supplier: { select: { id: true, corporateName: true } },
  status: { select: { id: true, name: true, color: true } },
  condition: { select: { id: true, name: true } },
  certifications: { orderBy: { createdAt: "desc" } },
} as const;

const DECIMAL_FIELDS = [
  "minimumStock",
  "maximumStock",
  "reorderPoint",
  "purchasePrice",
  "replacementCost",
] as const;

/**
 * Prisma retorna campos Decimal como instâncias de Decimal (decimal.js),
 * que não são serializáveis pela fronteira Server -> Client Component do
 * Next.js. Converte para number | null antes de passar para um componente
 * client.
 */
export function serializeAsset<T extends Record<string, unknown>>(asset: T) {
  const serialized = { ...asset } as Record<string, unknown>;
  for (const field of DECIMAL_FIELDS) {
    const value = serialized[field];
    serialized[field] =
      value && typeof value === "object" && "toNumber" in value
        ? (value as { toNumber: () => number }).toNumber()
        : null;
  }
  return serialized as Omit<T, (typeof DECIMAL_FIELDS)[number]> & {
    minimumStock: number | null;
    maximumStock: number | null;
    reorderPoint: number | null;
    purchasePrice: number | null;
    replacementCost: number | null;
  };
}
