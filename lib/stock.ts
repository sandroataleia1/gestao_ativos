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
export async function getStockMovements(companyId: string, filters: StockMovementFilters = {}) {
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
      take: 200,
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
      take: 200,
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
