import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import { buildCaStatusWhere, type CaStatusFilter } from "@/lib/certifications";
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

// Mesma composição de `assetListInclude`, mas com `certifications` limitado
// — usado só na listagem paginada (getAssetsPage), onde carregar o
// histórico inteiro de CA de cada linha da página não agrega nada ao badge
// (computeCaBadge só olha o mais recente por tipo). `assetListInclude`
// original continua sem limite para a tela de edição de um único ativo
// (`app/(app)/assets/[id]/edit/page.tsx`), que precisa do histórico
// completo.
const assetListIncludeForPage = {
  ...assetListInclude,
  certifications: {
    where: { certificationType: "CA" as const },
    orderBy: { createdAt: "desc" },
    take: 10,
  },
} as const;

export const ASSET_SORT_FIELDS = [
  "name",
  "assetCode",
  "category",
  "manufacturer",
  "status",
  "condition",
  "active",
] as const;
export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];

function buildAssetOrderBy(
  sort: AssetSortField,
  dir: "asc" | "desc",
): Prisma.AssetOrderByWithRelationInput {
  switch (sort) {
    case "assetCode":
      return { assetCode: dir };
    case "category":
      return { category: { name: dir } };
    case "manufacturer":
      return { manufacturer: { name: dir } };
    case "status":
      return { status: { name: dir } };
    case "condition":
      return { condition: { name: dir } };
    case "active":
      return { active: dir };
    default:
      return { name: dir };
  }
}

export type AssetsPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  statusId?: string;
  conditionId?: string;
  caStatus?: CaStatusFilter;
  sort: AssetSortField;
  dir: "asc" | "desc";
};

/** Busca paginada/filtrada/ordenada no servidor — substitui o
 * `findMany` sem `take`/`skip` que carregava todos os ativos da empresa de
 * uma vez (ver docs/performance.md). `where` reaproveita `buildCaStatusWhere`,
 * o mesmo helper já usado por GET /api/assets. */
export async function getAssetsPage(companyId: string, params: AssetsPageParams) {
  const { page, pageSize, search, categoryId, statusId, conditionId, caStatus, sort, dir } = params;

  const where: Prisma.AssetWhereInput = {
    companyId,
    ...(categoryId ? { categoryId } : {}),
    ...(statusId ? { statusId } : {}),
    ...(conditionId ? { conditionId } : {}),
    ...(caStatus ? buildCaStatusWhere(caStatus) : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { assetCode: { contains: search, mode: "insensitive" as const } },
            { category: { name: { contains: search, mode: "insensitive" as const } } },
            { manufacturer: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.asset.findMany({
      where,
      include: assetListIncludeForPage,
      orderBy: buildAssetOrderBy(sort, dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.asset.count({ where }),
  ]);

  return { rows: rows.map(serializeAsset), total };
}

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
