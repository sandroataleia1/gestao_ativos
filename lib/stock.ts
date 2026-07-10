import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";

/** Prisma retorna Decimal como instância de decimal.js — não serializável
 * pela fronteira Server -> Client Component. Converte para number. */
export function toNumber(value: unknown): number {
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return typeof value === "number" ? value : Number(value);
}

export async function getMovementType(companyId: string, name: string) {
  const movementType = await prisma.movementType.findFirst({ where: { companyId, name } });
  if (!movementType) {
    throw new ValidationError(
      `Tipo de movimentação "${name}" não está configurado para esta empresa.`,
    );
  }
  return movementType;
}

export async function assertLocationBelongsToCompany(companyId: string, locationId: string) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, companyId },
    select: { id: true },
  });
  if (!location) throw new ValidationError("Local inválido.");
  return location;
}

export async function assertAssetBelongsToCompany(companyId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, companyId } });
  if (!asset) throw new ValidationError("Ativo inválido.");
  return asset;
}

export async function assertStatusAndConditionBelongToCompany(
  companyId: string,
  statusId: string,
  conditionId: string,
) {
  const [status, condition] = await Promise.all([
    prisma.assetStatus.findFirst({ where: { id: statusId, companyId }, select: { id: true } }),
    prisma.assetCondition.findFirst({
      where: { id: conditionId, companyId },
      select: { id: true },
    }),
  ]);
  if (!status) throw new ValidationError("Status inválido.");
  if (!condition) throw new ValidationError("Condição inválida.");
}

const assetSelect = {
  id: true,
  name: true,
  assetCode: true,
  trackingMode: true,
  defaultUnit: true,
  category: { select: { id: true, name: true } },
} as const;

const locationSelect = { id: true, name: true } as const;
const movementTypeSelect = { id: true, name: true } as const;

export type StockFilters = {
  assetId?: string;
  categoryId?: string;
  locationId?: string;
};

/**
 * Saldo unificado: StockBalance cobre ativos CONSUMABLE (saldo real, em
 * quantidade); ativos INDIVIDUAL não têm StockBalance (por design — ver
 * comentário do model no schema), então "saldo" ali é a contagem de
 * AssetUnit ativos por local. Reaproveitado pela API (GET /api/stock) e
 * pela página /stock (fetch direto no Server Component).
 */
export async function getStockRows(companyId: string, filters: StockFilters = {}) {
  const { assetId, categoryId, locationId } = filters;

  let assetIdIn: string[] | undefined;
  if (categoryId) {
    const assets = await prisma.asset.findMany({
      where: { companyId, categoryId },
      select: { id: true },
    });
    assetIdIn = assets.map((a) => a.id);
  }

  const balances = await prisma.stockBalance.findMany({
    where: {
      companyId,
      ...(assetId ? { assetId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(assetIdIn ? { assetId: { in: assetIdIn } } : {}),
    },
    include: { asset: { select: assetSelect }, location: { select: locationSelect } },
  });

  const units = await prisma.assetUnit.findMany({
    where: {
      companyId,
      active: true,
      currentLocationId: locationId ? locationId : { not: null },
      ...(assetId ? { assetId } : {}),
      ...(assetIdIn ? { assetId: { in: assetIdIn } } : {}),
    },
    select: {
      assetId: true,
      asset: { select: assetSelect },
      currentLocationId: true,
      currentLocation: { select: locationSelect },
    },
  });

  type StockRow = {
    assetId: string;
    asset: (typeof balances)[number]["asset"];
    locationId: string;
    location: (typeof balances)[number]["location"];
    quantity: number;
  };

  const unitGroups = new Map<string, StockRow>();
  for (const unit of units) {
    if (!unit.currentLocationId) continue;
    const key = `${unit.assetId}:${unit.currentLocationId}`;
    const existing = unitGroups.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      unitGroups.set(key, {
        assetId: unit.assetId,
        asset: unit.asset,
        locationId: unit.currentLocationId,
        location: unit.currentLocation!,
        quantity: 1,
      });
    }
  }

  const rows: StockRow[] = [
    ...balances.map((balance) => ({
      assetId: balance.assetId,
      asset: balance.asset,
      locationId: balance.locationId,
      location: balance.location,
      quantity: toNumber(balance.quantity),
    })),
    ...Array.from(unitGroups.values()),
  ];

  return rows.sort((a, b) => a.asset.name.localeCompare(b.asset.name));
}

export const STOCK_SORT_FIELDS = ["asset", "code", "category", "location", "trackingMode", "quantity"] as const;
export type StockSortField = (typeof STOCK_SORT_FIELDS)[number];

function compareStockRows(
  a: Awaited<ReturnType<typeof getStockRows>>[number],
  b: Awaited<ReturnType<typeof getStockRows>>[number],
  sort: StockSortField,
): number {
  switch (sort) {
    case "code":
      return a.asset.assetCode.localeCompare(b.asset.assetCode);
    case "category":
      return a.asset.category.name.localeCompare(b.asset.category.name);
    case "location":
      return a.location.name.localeCompare(b.location.name);
    case "trackingMode":
      return a.asset.trackingMode.localeCompare(b.asset.trackingMode);
    case "quantity":
      return a.quantity - b.quantity;
    default:
      return a.asset.name.localeCompare(b.asset.name);
  }
}

export type StockPageParams = StockFilters & {
  page: number;
  pageSize: number;
  search?: string;
  sort?: StockSortField;
  dir?: "asc" | "desc";
};

/** `getStockRows` une duas fontes (StockBalance + AssetUnit agrupado) que o
 * Prisma não consegue paginar como uma única query — ver docs/performance.md
 * para a limitação estrutural aceita aqui. A busca em si continua trazendo
 * todas as linhas que batem com o filtro (igual antes), mas agora só as da
 * página pedida vão para o client — reduz o payload/DOM renderizado, mesmo
 * sem reduzir a leitura no banco. Como o merge já exige montar o array
 * inteiro em memória, a busca por texto e a ordenação por qualquer coluna
 * também são feitas aqui (sem custo adicional de banco) antes de fatiar a
 * página. Os cards de resumo da tela não dependem mais deste array (usam
 * aggregate/count separados, ver getStockSummary). */
export async function getStockRowsPage(companyId: string, params: StockPageParams) {
  const { page, pageSize, search, sort = "asset", dir = "asc", ...filters } = params;
  let allRows = await getStockRows(companyId, filters);

  if (search) {
    const q = search.toLowerCase();
    allRows = allRows.filter(
      (row) => row.asset.name.toLowerCase().includes(q) || row.asset.assetCode.toLowerCase().includes(q),
    );
  }

  allRows.sort((a, b) => (dir === "desc" ? -1 : 1) * compareStockRows(a, b, sort));
  const skip = (page - 1) * pageSize;
  return { rows: allRows.slice(skip, skip + pageSize), total: allRows.length };
}

/** Totais para os cards de resumo de /stock — usa aggregate/count em vez de
 * somar sobre o array de linhas carregado (evita depender de
 * `getStockRows` inteiro só para 4 números). */
export async function getStockSummary(companyId: string) {
  const [distinctAssetsBalance, distinctAssetsUnits, distinctLocationsBalance, distinctLocationsUnits, consumableSum, individualCount] =
    await Promise.all([
      prisma.stockBalance.findMany({ where: { companyId }, select: { assetId: true }, distinct: ["assetId"] }),
      prisma.assetUnit.findMany({
        where: { companyId, active: true, currentLocationId: { not: null } },
        select: { assetId: true },
        distinct: ["assetId"],
      }),
      prisma.stockBalance.findMany({ where: { companyId }, select: { locationId: true }, distinct: ["locationId"] }),
      prisma.assetUnit.findMany({
        where: { companyId, active: true, currentLocationId: { not: null } },
        select: { currentLocationId: true },
        distinct: ["currentLocationId"],
      }),
      prisma.stockBalance.aggregate({ where: { companyId }, _sum: { quantity: true } }),
      prisma.assetUnit.count({ where: { companyId, active: true, currentLocationId: { not: null } } }),
    ]);

  const distinctAssets = new Set([
    ...distinctAssetsBalance.map((r) => r.assetId),
    ...distinctAssetsUnits.map((r) => r.assetId),
  ]).size;
  const distinctLocations = new Set([
    ...distinctLocationsBalance.map((r) => r.locationId),
    ...distinctLocationsUnits.map((r) => r.currentLocationId),
  ]).size;

  return {
    distinctAssets,
    distinctLocations,
    consumableQuantity: toNumber(consumableSum._sum.quantity ?? 0),
    individualUnits: individualCount,
  };
}

export type StockMovementFilters = {
  assetId?: string;
  movementTypeId?: string;
  locationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

/**
 * Histórico unificado: StockMovement (consumíveis) + AssetMovement ligado a
 * uma AssetUnit (itens individuais). Reaproveitado pela API (GET
 * /api/stock/movements) e pela página /stock.
 */
export async function getStockMovements(
  companyId: string,
  filters: StockMovementFilters = {},
  limitPerSource = 200,
) {
  const { assetId, movementTypeId, locationId, dateFrom, dateTo } = filters;

  const executedAtFilter =
    dateFrom || dateTo
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        }
      : undefined;

  const locationFilter = locationId
    ? { OR: [{ originLocationId: locationId }, { destinationLocationId: locationId }] }
    : {};

  const movementAssetSelect = {
    id: true,
    name: true,
    assetCode: true,
    trackingMode: true,
  } as const;

  const [stockMovements, assetMovements] = await Promise.all([
    prisma.stockMovement.findMany({
      where: {
        companyId,
        ...(assetId ? { assetId } : {}),
        ...(movementTypeId ? { movementTypeId } : {}),
        ...(executedAtFilter ? { executedAt: executedAtFilter } : {}),
        ...locationFilter,
      },
      include: {
        asset: { select: movementAssetSelect },
        movementType: { select: movementTypeSelect },
        originLocation: { select: locationSelect },
        destinationLocation: { select: locationSelect },
      },
      orderBy: { executedAt: "desc" },
      take: limitPerSource,
    }),
    prisma.assetMovement.findMany({
      where: {
        companyId,
        assetUnitId: { not: null },
        ...(assetId ? { assetId } : {}),
        ...(movementTypeId ? { movementTypeId } : {}),
        ...(executedAtFilter ? { executedAt: executedAtFilter } : {}),
        ...locationFilter,
      },
      include: {
        asset: { select: movementAssetSelect },
        assetUnit: { select: { id: true, serialNumber: true, patrimonyNumber: true } },
        movementType: { select: movementTypeSelect },
        originLocation: { select: locationSelect },
        destinationLocation: { select: locationSelect },
      },
      orderBy: { executedAt: "desc" },
      take: limitPerSource,
    }),
  ]);

  const movements = [
    ...stockMovements.map((m) => ({
      id: m.id,
      kind: "STOCK" as const,
      asset: m.asset,
      assetUnit: null as { id: string; serialNumber: string | null; patrimonyNumber: string | null } | null,
      movementType: m.movementType,
      quantity: toNumber(m.quantity),
      originLocation: m.originLocation,
      destinationLocation: m.destinationLocation,
      observations: m.observations,
      executedAt: m.executedAt,
    })),
    ...assetMovements.map((m) => ({
      id: m.id,
      kind: "ASSET_UNIT" as const,
      asset: m.asset,
      assetUnit: m.assetUnit,
      movementType: m.movementType,
      quantity: toNumber(m.quantity),
      originLocation: m.originLocation,
      destinationLocation: m.destinationLocation,
      observations: m.observations,
      executedAt: m.executedAt,
    })),
  ];

  return movements.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
}

const MAX_MOVEMENTS_MERGE = 1000;

export type StockMovementsPageParams = StockMovementFilters & { page: number; pageSize: number };

/** Paginação sobre a mesma união StockMovement + AssetMovement de
 * `getStockMovements` — como as duas fontes vêm ordenadas por
 * `executedAt desc` só é preciso buscar, de cada uma, o suficiente para
 * cobrir até o fim da página pedida (nunca a tabela inteira), com um teto de
 * segurança (histórico muito antigo fica fora da paginação normal; use
 * Relatórios para exportar tudo). */
export async function getStockMovementsPage(companyId: string, params: StockMovementsPageParams) {
  const { page, pageSize, ...filters } = params;
  const skip = (page - 1) * pageSize;
  const fetchLimit = Math.min(skip + pageSize, MAX_MOVEMENTS_MERGE);

  const [total, movements] = await Promise.all([
    getStockMovementsCount(companyId, filters),
    getStockMovements(companyId, filters, fetchLimit),
  ]);

  return { rows: movements.slice(skip, skip + pageSize), total };
}

async function getStockMovementsCount(companyId: string, filters: StockMovementFilters) {
  const { assetId, movementTypeId, locationId, dateFrom, dateTo } = filters;
  const executedAtFilter =
    dateFrom || dateTo
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        }
      : undefined;
  const locationFilter = locationId
    ? { OR: [{ originLocationId: locationId }, { destinationLocationId: locationId }] }
    : {};

  const [stockCount, assetCount] = await Promise.all([
    prisma.stockMovement.count({
      where: {
        companyId,
        ...(assetId ? { assetId } : {}),
        ...(movementTypeId ? { movementTypeId } : {}),
        ...(executedAtFilter ? { executedAt: executedAtFilter } : {}),
        ...locationFilter,
      },
    }),
    prisma.assetMovement.count({
      where: {
        companyId,
        assetUnitId: { not: null },
        ...(assetId ? { assetId } : {}),
        ...(movementTypeId ? { movementTypeId } : {}),
        ...(executedAtFilter ? { executedAt: executedAtFilter } : {}),
        ...locationFilter,
      },
    }),
  ]);

  return stockCount + assetCount;
}
