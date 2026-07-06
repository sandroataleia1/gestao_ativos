import { prisma } from "@/lib/prisma";

// Location/LocationType/MovementType não têm @@unique([companyId, name]) no
// schema — idempotência via findFirst/create (mesmo padrão já usado antes
// em prisma/seed.ts). Garante que toda empresa tenha um local padrão de
// estoque e os tipos de movimentação básicos mesmo sem rodar o seed manual
// (fluxo público de /register) — sem isso, "Nova entrada de estoque" e a
// entrega/devolução de custódia ficam impossíveis: ambas dependem de
// MovementType, e a entrada de estoque agora nem deixa mais escolher local
// na UI (ver app/(app)/stock/stock-entry-dialog.tsx).

export const DEFAULT_WAREHOUSE_LOCATION_TYPE = "Almoxarifado";
export const DEFAULT_WAREHOUSE_LOCATION_NAME = "Almoxarifado Principal";
export const DEFAULT_MOVEMENT_TYPES = ["ENTRY", "EXIT", "DELIVERY", "RETURN"] as const;

export async function provisionDefaultStockSetup(companyId: string) {
  const existingLocationType = await prisma.locationType.findFirst({
    where: { companyId, name: DEFAULT_WAREHOUSE_LOCATION_TYPE },
  });
  const locationType =
    existingLocationType ??
    (await prisma.locationType.create({
      data: { companyId, name: DEFAULT_WAREHOUSE_LOCATION_TYPE },
    }));

  const existingLocation = await prisma.location.findFirst({
    where: { companyId, name: DEFAULT_WAREHOUSE_LOCATION_NAME },
  });
  const location =
    existingLocation ??
    (await prisma.location.create({
      data: { companyId, name: DEFAULT_WAREHOUSE_LOCATION_NAME, locationTypeId: locationType.id },
    }));

  const movementTypes = new Map<string, { id: string }>();
  for (const name of DEFAULT_MOVEMENT_TYPES) {
    const existing = await prisma.movementType.findFirst({ where: { companyId, name } });
    const movementType =
      existing ?? (await prisma.movementType.create({ data: { companyId, name } }));
    movementTypes.set(name, movementType);
  }

  return { location, locationType, movementTypes };
}

// Resolve o local padrão de estoque da empresa, provisionando-o na hora se
// por algum motivo ainda não existir (ex.: empresa criada antes desta
// função existir e que ainda não passou pelo backfill).
export async function getDefaultWarehouseLocationId(companyId: string): Promise<string> {
  const existing = await prisma.location.findFirst({
    where: { companyId, name: DEFAULT_WAREHOUSE_LOCATION_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const { location } = await provisionDefaultStockSetup(companyId);
  return location.id;
}
