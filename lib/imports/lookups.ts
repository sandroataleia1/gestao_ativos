import type { Prisma } from "@/app/generated/prisma/client";

// "Find or create por nome" pros cadastros de apoio referenciados pela
// planilha (Setor/Cargo/Categoria/Fabricante/Fornecedor/Local) — nenhum
// desses tinha esse helper no lado servidor ainda (só criação direta nas
// rotas de /cadastros, ou criação rápida via UI). Em modo `dryRun` (usado no
// preview) nunca cria nada, só verifica se já existe — quem chama decide o
// que fazer quando `null` volta (normalmente: nota "será criado").

type FindOrCreateResult = { id: string; created: boolean } | null;

async function findOrCreateByName<T extends { id: string }>(params: {
  find: () => Promise<T | null>;
  create: () => Promise<T>;
  dryRun: boolean;
}): Promise<FindOrCreateResult> {
  const existing = await params.find();
  if (existing) return { id: existing.id, created: false };
  if (params.dryRun) return null;

  const created = await params.create();
  return { id: created.id, created: true };
}

export async function findOrCreateDepartment(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    find: () => tx.department.findFirst({ where: { companyId, name: { equals: trimmed, mode: "insensitive" } } }),
    create: () => tx.department.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreatePosition(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
    find: () => tx.position.findFirst({ where: { companyId, name: { equals: trimmed, mode: "insensitive" } } }),
    create: () => tx.position.create({ data: { companyId, name: trimmed } }),
    dryRun,
  });
}

export async function findOrCreateAssetCategory(
  tx: Prisma.TransactionClient,
  companyId: string,
  name: string,
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
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
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
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
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = corporateName.trim();
  if (!trimmed) return null;
  return findOrCreateByName({
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
  dryRun: boolean,
): Promise<FindOrCreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existingLocation = await tx.location.findFirst({
    where: { companyId, name: { equals: trimmed, mode: "insensitive" }, active: true },
  });
  if (existingLocation) return { id: existingLocation.id, created: false };
  if (dryRun) return null;

  const locationType =
    (await tx.locationType.findFirst({ where: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME } })) ??
    (await tx.locationType.create({ data: { companyId, name: WAREHOUSE_LOCATION_TYPE_NAME } }));

  const created = await tx.location.create({
    data: { companyId, name: trimmed, locationTypeId: locationType.id },
  });
  return { id: created.id, created: true };
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
