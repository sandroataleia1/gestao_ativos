import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Busca paginada/ordenada no servidor pros 3 cadastros que compartilham
// `LookupManager` (categorias, fabricantes, fornecedores) — substitui o
// `findMany` sem `take`/`skip` que carregava tudo de uma vez e filtrava/
// ordenava em `useMemo` no client (ver app/(app)/cadastros/lookup-manager.tsx).

export type LookupPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  dir: "asc" | "desc";
};

function buildOrderBy(sort: string | undefined, dir: "asc" | "desc", allowed: string[], fallback: string) {
  const field = sort && allowed.includes(sort) ? sort : fallback;
  return { [field]: dir } as Record<string, "asc" | "desc">;
}

export async function getCategoriesPage(companyId: string, params: LookupPageParams) {
  const { page, pageSize, search, sort, dir } = params;
  const where: Prisma.AssetCategoryWhereInput = {
    companyId,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.assetCategory.findMany({
      where,
      orderBy: buildOrderBy(sort, dir, ["name", "description", "color"], "name"),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assetCategory.count({ where }),
  ]);
  return { rows, total };
}

export async function getManufacturersPage(companyId: string, params: LookupPageParams) {
  const { page, pageSize, search, sort, dir } = params;
  const where: Prisma.ManufacturerWhereInput = {
    companyId,
    deletedAt: null,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.manufacturer.findMany({
      where,
      orderBy: buildOrderBy(sort, dir, ["name", "document", "phone", "email"], "name"),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.manufacturer.count({ where }),
  ]);
  return { rows, total };
}

export async function getSuppliersPage(companyId: string, params: LookupPageParams) {
  const { page, pageSize, search, sort, dir } = params;
  const where: Prisma.SupplierWhereInput = {
    companyId,
    ...(search ? { corporateName: { contains: search, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.supplier.findMany({
      where,
      orderBy: buildOrderBy(sort, dir, ["corporateName", "tradeName", "document", "phone"], "corporateName"),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.supplier.count({ where }),
  ]);
  return { rows, total };
}
