import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";

// Popula uma empresa já existente com milhares de registros, só para
// permitir testar/medir paginação, índices e cache com volume real — o
// seed normal (prisma/seed.ts) tem de propósito só ~15 registros
// (cenário mínimo de demonstração). Roda separado, sob demanda
// (`npm run db:seed:bulk`), nunca como parte do seed padrão.
//
// Todo registro criado aqui é prefixado com "Bulk"/"BULK-" para permitir
// checar se já rodou (idempotência simples: se já existem colaboradores
// bulk suficientes, o script sai sem duplicar) e para nunca ser confundido
// com dado real de uma empresa em produção.

const DEMO_COMPANY_NAME = "Empresa Demo";

const TARGET_DEPARTMENTS = 10;
const TARGET_POSITIONS = 10;
const TARGET_EMPLOYEES = 2000;
const TARGET_CATEGORIES = 6;
const TARGET_MANUFACTURERS = 4;
const TARGET_ASSETS = 5000;
const TARGET_CUSTODIES = 8000;
const TARGET_STOCK_MOVEMENTS = 3000;
const TARGET_CERTIFICATIONS = 500;

const CHUNK_SIZE = 500;

function pad(n: number, width: number) {
  return String(n).padStart(width, "0");
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function randomDateWithinPastDays(days: number) {
  const now = Date.now();
  return new Date(now - randomInt(0, days) * 24 * 60 * 60 * 1000);
}

async function chunked<T>(items: T[], size: number, fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

async function getTargetCompany() {
  const explicitId = process.env.BULK_COMPANY_ID;
  if (explicitId) {
    return prisma.company.findUniqueOrThrow({ where: { id: explicitId } });
  }
  return prisma.company.findFirstOrThrow({
    where: { name: DEMO_COMPANY_NAME },
    orderBy: { createdAt: "asc" },
  });
}

async function alreadySeeded(companyId: string) {
  const count = await prisma.employee.count({
    where: { companyId, document: { startsWith: "BULK-EMP-" } },
  });
  return count >= TARGET_EMPLOYEES;
}

async function seedDepartmentsAndPositions(companyId: string) {
  const departments: { id: string }[] = [];
  for (let i = 1; i <= TARGET_DEPARTMENTS; i++) {
    const name = `Departamento Bulk ${pad(i, 2)}`;
    departments.push(
      await prisma.department.upsert({
        where: { companyId_name: { companyId, name } },
        update: {},
        create: { companyId, name },
        select: { id: true },
      }),
    );
  }

  const positions: { id: string }[] = [];
  for (let i = 1; i <= TARGET_POSITIONS; i++) {
    const name = `Cargo Bulk ${pad(i, 2)}`;
    positions.push(
      await prisma.position.upsert({
        where: { companyId_name: { companyId, name } },
        update: {},
        create: { companyId, name },
        select: { id: true },
      }),
    );
  }

  return { departments, positions };
}

async function seedEmployees(companyId: string, departments: { id: string }[], positions: { id: string }[]) {
  const data = Array.from({ length: TARGET_EMPLOYEES }, (_, index) => {
    const i = index + 1;
    return {
      companyId,
      name: `Colaborador Bulk ${pad(i, 5)}`,
      document: `BULK-EMP-${pad(i, 6)}`,
      email: `bulk.employee.${i}@loadtest.local`,
      departmentId: pick(departments).id,
      positionId: pick(positions).id,
      status: (Math.random() < 0.9 ? "ACTIVE" : "INACTIVE") as "ACTIVE" | "INACTIVE",
    };
  });

  await chunked(data, CHUNK_SIZE, (batch) => prisma.employee.createMany({ data: batch }));

  return prisma.employee.findMany({
    where: { companyId, document: { startsWith: "BULK-EMP-" } },
    select: { id: true },
  });
}

async function seedAssetLookups(companyId: string) {
  const categories: { id: string }[] = [];
  for (let i = 1; i <= TARGET_CATEGORIES; i++) {
    const name = `Categoria Bulk ${pad(i, 2)}`;
    const existing = await prisma.assetCategory.findFirst({ where: { companyId, name } });
    categories.push(existing ?? (await prisma.assetCategory.create({ data: { companyId, name } })));
  }

  const manufacturers: { id: string }[] = [];
  for (let i = 1; i <= TARGET_MANUFACTURERS; i++) {
    const name = `Fabricante Bulk ${pad(i, 2)}`;
    const existing = await prisma.manufacturer.findFirst({ where: { companyId, name } });
    manufacturers.push(existing ?? (await prisma.manufacturer.create({ data: { companyId, name } })));
  }

  const supplierName = "Fornecedor Bulk Ltda";
  const supplier =
    (await prisma.supplier.findFirst({ where: { companyId, corporateName: supplierName } })) ??
    (await prisma.supplier.create({ data: { companyId, corporateName: supplierName } }));

  const { statuses, conditions } = await provisionDefaultAssetStatusesAndConditions(companyId);
  const { location: warehouseLocation, movementTypes } = await provisionDefaultStockSetup(companyId);

  return {
    categories,
    manufacturers,
    supplier,
    statuses: [...statuses.values()],
    conditions: [...conditions.values()],
    warehouseLocation,
    movementTypes,
  };
}

async function seedAssets(
  companyId: string,
  lookups: Awaited<ReturnType<typeof seedAssetLookups>>,
) {
  const data = Array.from({ length: TARGET_ASSETS }, (_, index) => {
    const i = index + 1;
    // ~70% consumível / 30% individual — mistura realista para exercitar os
    // dois caminhos de estoque (StockBalance vs AssetUnit) no benchmark.
    const trackingMode: "CONSUMABLE" | "INDIVIDUAL" =
      Math.random() < 0.7 ? "CONSUMABLE" : "INDIVIDUAL";
    return {
      companyId,
      name: `Ativo Bulk ${pad(i, 6)}`,
      assetCode: `BULK-AST-${pad(i, 6)}`,
      categoryId: pick(lookups.categories).id,
      manufacturerId: pick(lookups.manufacturers).id,
      supplierId: lookups.supplier.id,
      statusId: pick(lookups.statuses).id,
      conditionId: pick(lookups.conditions).id,
      trackingMode,
      defaultUnit: trackingMode === "CONSUMABLE" ? "un" : null,
    };
  });

  const created: { id: string; trackingMode: "CONSUMABLE" | "INDIVIDUAL" }[] = [];
  await chunked(data, CHUNK_SIZE, async (batch) => {
    const rows = await prisma.asset.createManyAndReturn({
      data: batch,
      select: { id: true, trackingMode: true },
    });
    created.push(...rows);
  });

  return created;
}

async function seedStockForAssets(
  companyId: string,
  assets: { id: string; trackingMode: "CONSUMABLE" | "INDIVIDUAL" }[],
  lookups: Awaited<ReturnType<typeof seedAssetLookups>>,
) {
  const consumables = assets.filter((a) => a.trackingMode === "CONSUMABLE");
  const individuals = assets.filter((a) => a.trackingMode === "INDIVIDUAL");

  const balances = consumables.map((asset) => ({
    companyId,
    assetId: asset.id,
    locationId: lookups.warehouseLocation.id,
    quantity: randomInt(20, 500),
  }));
  await chunked(balances, CHUNK_SIZE, (batch) => prisma.stockBalance.createMany({ data: batch, skipDuplicates: true }));

  const units = individuals.map((asset, index) => {
    const i = index + 1;
    return {
      companyId,
      assetId: asset.id,
      serialNumber: `BULK-SN-${pad(i, 6)}`,
      patrimonyNumber: `BULK-PN-${pad(i, 6)}`,
      statusId: pick(lookups.statuses).id,
      conditionId: pick(lookups.conditions).id,
      currentLocationId: lookups.warehouseLocation.id,
    };
  });
  const createdUnits: { id: string; assetId: string }[] = [];
  await chunked(units, CHUNK_SIZE, async (batch) => {
    const rows = await prisma.assetUnit.createManyAndReturn({
      data: batch,
      select: { id: true, assetId: true },
    });
    createdUnits.push(...rows);
  });

  const movementData = consumables.slice(0, TARGET_STOCK_MOVEMENTS).map((asset) => ({
    companyId,
    assetId: asset.id,
    movementTypeId: lookups.movementTypes.get("ENTRY")!.id,
    quantity: randomInt(1, 100),
    destinationLocationId: lookups.warehouseLocation.id,
    executedAt: randomDateWithinPastDays(365),
    observations: "Movimentação (seed em massa)",
  }));
  await chunked(movementData, CHUNK_SIZE, (batch) => prisma.stockMovement.createMany({ data: batch }));

  return { consumables, individualUnits: createdUnits };
}

async function seedCertifications(
  companyId: string,
  assets: { id: string; trackingMode: "CONSUMABLE" | "INDIVIDUAL" }[],
) {
  const targets = assets.slice(0, TARGET_CERTIFICATIONS);
  const data = targets.map((asset, index) => {
    const i = index + 1;
    // Distribui vencimentos: 1/3 já vencido, 1/3 vencendo em até 30 dias,
    // 1/3 vigente por bastante tempo — cobre os três buckets do relatório/
    // alerta de CA.
    const bucket = i % 3;
    const expirationDate =
      bucket === 0
        ? new Date(Date.now() - randomInt(1, 180) * 24 * 60 * 60 * 1000)
        : bucket === 1
          ? new Date(Date.now() + randomInt(1, 30) * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + randomInt(90, 700) * 24 * 60 * 60 * 1000);
    return {
      companyId,
      assetId: asset.id,
      certificationType: "CA" as const,
      certificationNumber: `BULK-CA-${pad(i, 6)}`,
      status: (bucket === 0 ? "EXPIRED" : "VALID") as "EXPIRED" | "VALID",
      expirationDate,
      issueDate: new Date(expirationDate.getTime() - 365 * 24 * 60 * 60 * 1000),
      issuer: "Órgão Bulk",
    };
  });
  await chunked(data, CHUNK_SIZE, (batch) => prisma.assetCertification.createMany({ data: batch }));
}

async function seedEmployeeLocations(companyId: string, employees: { id: string }[]) {
  const locationType =
    (await prisma.locationType.findFirst({ where: { companyId, name: "Colaborador" } })) ??
    (await prisma.locationType.create({ data: { companyId, name: "Colaborador" } }));

  const data = employees.map((employee) => ({
    companyId,
    name: employee.id,
    locationTypeId: locationType.id,
    referenceId: employee.id,
  }));

  const created: { id: string; referenceId: string | null }[] = [];
  await chunked(data, CHUNK_SIZE, async (batch) => {
    const rows = await prisma.location.createManyAndReturn({
      data: batch,
      select: { id: true, referenceId: true },
    });
    created.push(...rows);
  });

  return new Map(created.map((location) => [location.referenceId!, location.id]));
}

async function seedCustodies(
  companyId: string,
  employees: { id: string }[],
  consumables: { id: string }[],
  individualUnits: { id: string; assetId: string }[],
  employeeLocationByEmployeeId: Map<string, string>,
) {
  // Regra de negócio real (migration custody_active_unit_unique): uma
  // AssetUnit só pode ter UMA custódia ACTIVE por vez (índice único parcial
  // no banco). Rastreamos as unidades já "ocupadas" nesta geração e forçamos
  // RETURNED para qualquer sorteio repetido da mesma unidade — histórico
  // (RETURNED) pode se repetir à vontade, só ACTIVE é exclusivo.
  const usedActiveUnitIds = new Set<string>();

  const data = Array.from({ length: TARGET_CUSTODIES }, () => {
    const employee = pick(employees);
    const holderLocationId = employeeLocationByEmployeeId.get(employee.id)!;
    const useIndividual = individualUnits.length > 0 && Math.random() < 0.35;
    const unit = useIndividual ? pick(individualUnits) : null;

    const deliveredAt = randomDateWithinPastDays(730);
    // ~60% já devolvida, ~40% ativa (e, dentro das ativas, ~15% com prazo
    // vencido — para popular o alerta/relatório de atraso). Se a unidade já
    // tiver uma ACTIVE nesta geração, força devolvida.
    const wantsActive = Math.random() >= 0.6;
    const isReturned = !wantsActive || (unit !== null && usedActiveUnitIds.has(unit.id));
    if (unit && !isReturned) usedActiveUnitIds.add(unit.id);
    const isOverdue = !isReturned && Math.random() < 0.15;
    const expectedReturnAt = isReturned
      ? new Date(deliveredAt.getTime() + randomInt(1, 60) * 24 * 60 * 60 * 1000)
      : isOverdue
        ? randomDateWithinPastDays(30)
        : new Date(Date.now() + randomInt(1, 90) * 24 * 60 * 60 * 1000);
    const returnedAt = isReturned
      ? new Date(deliveredAt.getTime() + randomInt(1, 60) * 24 * 60 * 60 * 1000)
      : null;

    if (unit) {
      return {
        companyId,
        employeeId: employee.id,
        assetId: unit.assetId,
        assetUnitId: unit.id,
        holderLocationId,
        quantity: 1,
        status: (isReturned ? "RETURNED" : "ACTIVE") as "ACTIVE" | "RETURNED",
        deliveredAt,
        expectedReturnAt,
        returnedAt,
      };
    }

    const asset = pick(consumables);
    return {
      companyId,
      employeeId: employee.id,
      assetId: asset.id,
      assetUnitId: null,
      holderLocationId,
      quantity: randomInt(1, 10),
      status: (isReturned ? "RETURNED" : "ACTIVE") as "ACTIVE" | "RETURNED",
      deliveredAt,
      expectedReturnAt,
      returnedAt,
    };
  });

  await chunked(data, CHUNK_SIZE, (batch) => prisma.assetCustody.createMany({ data: batch }));
}

async function main() {
  const company = await getTargetCompany();
  console.log(`Empresa alvo: ${company.name} (${company.id})`);

  if (await alreadySeeded(company.id)) {
    console.log("Seed em massa já aplicado para esta empresa (colaboradores BULK-EMP- >= alvo). Nada a fazer.");
    return;
  }

  console.log("Departamentos/cargos...");
  const { departments, positions } = await seedDepartmentsAndPositions(company.id);

  console.log(`Colaboradores (${TARGET_EMPLOYEES})...`);
  const employees = await seedEmployees(company.id, departments, positions);

  console.log("Categorias/fabricantes/fornecedor/status/condição/local padrão...");
  const lookups = await seedAssetLookups(company.id);

  console.log(`Ativos (${TARGET_ASSETS})...`);
  const assets = await seedAssets(company.id, lookups);

  console.log("Saldo de estoque + unidades individuais + movimentações...");
  const { consumables, individualUnits } = await seedStockForAssets(company.id, assets, lookups);

  console.log(`Certificações CA (${TARGET_CERTIFICATIONS})...`);
  await seedCertifications(company.id, assets);

  console.log("Locais por colaborador (para custódia)...");
  const employeeLocationByEmployeeId = await seedEmployeeLocations(company.id, employees);

  console.log(`Custódias (${TARGET_CUSTODIES})...`);
  await seedCustodies(company.id, employees, consumables, individualUnits, employeeLocationByEmployeeId);

  console.log("Seed em massa concluído:");
  console.log(`  Colaboradores: ${employees.length}`);
  console.log(`  Ativos: ${assets.length} (${consumables.length} consumíveis, ${individualUnits.length} individuais)`);
  console.log(`  Custódias: ${TARGET_CUSTODIES}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
