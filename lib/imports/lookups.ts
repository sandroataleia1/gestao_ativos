import type { Prisma } from "@/app/generated/prisma/client";

// "Find or create por nome" pros cadastros de apoio referenciados pela
// planilha (Setor/Cargo/Categoria/Fabricante/Fornecedor/Local) — nenhum
// desses tinha esse helper no lado servidor ainda (só criação direta nas
// rotas de /cadastros, ou criação rápida via UI). Em modo `dryRun` (usado no
// preview) nunca cria nada, só verifica se já existe — quem chama decide o
// que fazer quando `null` volta (normalmente: nota "será criado").

type FindOrCreateResult = { id: string; created: boolean } | null;

// Cache em memória, escopado a UMA execução de importação (criado por
// createImportLookupCache() em process.ts e passado por todas as linhas) —
// evita repetir findFirst pro mesmo nome em planilhas de milhares de linhas
// com poucos valores distintos de categoria/fabricante/fornecedor/local/
// setor/cargo (ex.: 1.000 linhas, 5 categorias -> só 5 idas ao banco em vez
// de até 1.000). Cacheia inclusive o resultado "não encontrado" (dryRun):
// se a mesma planilha repete um nome novo, a segunda ocorrência já sabe que
// "será criado" sem perguntar de novo ao banco.
export type ImportLookupCache = {
  departments: Map<string, FindOrCreateResult>;
  positions: Map<string, FindOrCreateResult>;
  categories: Map<string, FindOrCreateResult>;
  manufacturers: Map<string, FindOrCreateResult>;
  suppliers: Map<string, FindOrCreateResult>;
  locations: Map<string, FindOrCreateResult>;
};

export function createImportLookupCache(): ImportLookupCache {
  return {
    departments: new Map(),
    positions: new Map(),
    categories: new Map(),
    manufacturers: new Map(),
    suppliers: new Map(),
    locations: new Map(),
  };
}

async function findOrCreateByName<T extends { id: string }>(params: {
  cache: Map<string, FindOrCreateResult>;
  cacheKey: string;
  find: () => Promise<T | null>;
  create: () => Promise<T>;
  dryRun: boolean;
}): Promise<FindOrCreateResult> {
  const cached = params.cache.get(params.cacheKey);
  if (cached !== undefined) return cached;

  const existing = await params.find();
  if (existing) {
    const result: FindOrCreateResult = { id: existing.id, created: false };
    params.cache.set(params.cacheKey, result);
    return result;
  }
  if (params.dryRun) {
    params.cache.set(params.cacheKey, null);
    return null;
  }

  const created = await params.create();
  const result: FindOrCreateResult = { id: created.id, created: true };
  params.cache.set(params.cacheKey, result);
  return result;
}

export async function findOrCreateDepartment(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    cache,
    cacheKey: trimmed.toLowerCase(),
    find: () => tx.department.findFirst({ where: { companyId, name: { equals: trimmed, mode: "insensitive" } } }),
    create: () => tx.department.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreatePosition(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    cache,
    cacheKey: trimmed.toLowerCase(),
    find: () => tx.position.findFirst({ where: { companyId, name: { equals: trimmed, mode: "insensitive" } } }),
    create: () => tx.position.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreateAssetCategory(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    cache,
    cacheKey: trimmed.toLowerCase(),
    find: () =>
      tx.assetCategory.findFirst({
        where: { companyId, name: { equals: trimmed, mode: "insensitive" }, deletedAt: null },
      }),
    create: () => tx.assetCategory.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreateManufacturer(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    cache,
    cacheKey: trimmed.toLowerCase(),
    find: () =>
      tx.manufacturer.findFirst({
        where: { companyId, name: { equals: trimmed, mode: "insensitive" }, deletedAt: null },
      }),
    create: () => tx.manufacturer.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreateSupplier(
  tx: Prisma.TransactionClient,
  companyId: string,
  corporateName: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = corporateName.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    cache,
    cacheKey: trimmed.toLowerCase(),
    find: () =>
      tx.supplier.findFirst({
        where: { companyId, corporateName: { equals: trimmed, mode: "insensitive" }, active: true },
      }),
    create: () => tx.supplier.create({ data: { companyId, corporateName: trimmed } }),
    dryRun,
  });
}

const WAREHOUSE_LOCATION_TYPE_NAME = "Almoxarifado";

/**
 * Local de estoque referenciado pela planilha (coluna `local`) — mesmo tipo
 * "Almoxarifado" usado por getOrCreateWarehouseLocation (lib/custodies),
 * mas por nome livre em vez do nome fixo "Almoxarifado Principal", já que
 * uma empresa pode ter mais de um local (ex.: "Almoxarifado Filial 2").
 */
export async function findOrCreateStockLocation(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  cache: Map<string, FindOrCreateResult>,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const cached = cache.get(trimmed.toLowerCase());
  if (cached !== undefined) return cached;

  const existingLocation = await tx.location.findFirst({
    where: { companyId, name: { equals: trimmed, mode: "insensitive" }, active: true },
  });
  if (existingLocation) {
    const result: FindOrCreateResult = { id: existingLocation.id, created: false };
    cache.set(trimmed.toLowerCase(), result);
    return result;
  }
  if (dryRun) {
    cache.set(trimmed.toLowerCase(), null);
    return null;
  }

  const locationType =
    (await tx.locationType.findFirst({ where: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME } })) ??
    (await tx.locationType.create({ data: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME } }));

  const created = await tx.location.create({
    data: { companyId, name: trimmed, locationTypeId: locationType.id },
  });
  const result: FindOrCreateResult = { id: created.id, created: true };
  cache.set(trimmed.toLowerCase(), result);
  return result;
}

export type NamedLookup = { id: string; name: string };

/**
 * Resolve Status/Condição de ativo por nome (case-insensitive); se não
 * achar, cai no mesmo critério de default já usado em
 * app/(app)/assets/asset-form.tsx (`pickDefaultId`): usa o nome preferido do
 * sistema (Disponível/Novo) e, na ausência dele, o primeiro da lista. Nunca
 * cria um Status/Condição novo a partir da planilha — evita nome digitado
 * errado virar registro permanente (diferente de Categoria/Fabricante/
 * Fornecedor/Local, que são livres pra a empresa nomear como quiser).
 */
export function resolveByNameOrDefault(
  options: NamedLookup[],
  rawName: string,
  preferredNames: string[],
): { id: string; matched: boolean } | null {
  if (!options.length) return null;

  const trimmed = rawName.trim();
  if (trimmed) {
    const match = options.find((option) => option.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (match) return { id: match.id, matched: true };
  }

  const preferred = options.find((option) =>
    preferredNames.some((name) => option.name.trim().toLowerCase() === name.toLowerCase()),
  );
  return { id: (preferred ?? options[0]).id, matched: false };
}
