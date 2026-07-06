import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { provisionDefaultRolesForCompany } from "@/lib/rbac-provisioning";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";

const DEMO_COMPANY_NAME = "Empresa Demo";
const DEMO_ADMIN_EMAIL = "admin@demo.com";
const DEMO_ADMIN_PASSWORD = "Demo@12345";

// Um usuário demo por papel, além do admin — só para permitir testar
// manualmente o comportamento de RBAC de cada papel (ver
// docs/auth-rbac.md) sem precisar criar contas na mão. Mesma senha do
// admin, só para facilitar QA local.
const DEMO_ROLE_USERS = [
  { email: "rh@demo.com", name: "RH Demo", role: SYSTEM_ROLES.RH },
  { email: "almoxarifado@demo.com", name: "Almoxarifado Demo", role: SYSTEM_ROLES.ALMOXARIFADO },
  { email: "consulta@demo.com", name: "Consulta Demo", role: SYSTEM_ROLES.CONSULTA },
] as const;

async function seedCompany() {
  const existing = await prisma.company.findFirst({
    where: { name: DEMO_COMPANY_NAME },
  });
  if (existing) return existing;

  return prisma.company.create({
    data: { name: DEMO_COMPANY_NAME, document: "00.000.000/0001-00" },
  });
}

async function seedDemoUser(
  companyId: string,
  roleId: string,
  input: { name: string; email: string; password: string },
) {
  let user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    const result = await signUpEmailInternal({
      name: input.name,
      email: input.email,
      password: input.password,
      companyId,
    });
    user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    update: {},
    create: { userId: user.id, companyId, roleId },
  });

  return user;
}

async function seedAdminUser(companyId: string, adminRoleId: string) {
  return seedDemoUser(companyId, adminRoleId, {
    name: "Administrador Demo",
    email: DEMO_ADMIN_EMAIL,
    password: DEMO_ADMIN_PASSWORD,
  });
}

async function seedRoleDemoUsers(companyId: string, roles: Map<string, { id: string }>) {
  const users = [];
  for (const { email, name, role } of DEMO_ROLE_USERS) {
    const roleRecord = roles.get(role);
    if (!roleRecord) continue;
    users.push(
      await seedDemoUser(companyId, roleRecord.id, { name, email, password: DEMO_ADMIN_PASSWORD }),
    );
  }
  return users;
}

const DEMO_DEPARTMENTS = ["Administrativo", "Operações", "Tecnologia da Informação"];
const DEMO_POSITIONS = ["Analista", "Assistente", "Gerente"];

const DEMO_EMPLOYEES = [
  {
    name: "Ana Souza",
    document: "111.111.111-11",
    email: "ana.souza@empresademo.com",
    department: "Administrativo",
    position: "Gerente",
    status: "ACTIVE" as const,
  },
  {
    name: "Bruno Lima",
    document: "222.222.222-22",
    email: "bruno.lima@empresademo.com",
    department: "Operações",
    position: "Assistente",
    status: "ACTIVE" as const,
  },
  {
    name: "Carla Mendes",
    document: "333.333.333-33",
    email: "carla.mendes@empresademo.com",
    department: "Tecnologia da Informação",
    position: "Analista",
    status: "ACTIVE" as const,
  },
  {
    name: "Diego Ferreira",
    document: "444.444.444-44",
    department: "Operações",
    position: "Assistente",
    status: "INACTIVE" as const,
  },
];

async function seedEmployees(companyId: string) {
  const departments = new Map<string, string>();
  for (const name of DEMO_DEPARTMENTS) {
    const department = await prisma.department.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name },
    });
    departments.set(name, department.id);
  }

  const positions = new Map<string, string>();
  for (const name of DEMO_POSITIONS) {
    const position = await prisma.position.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name },
    });
    positions.set(name, position.id);
  }

  for (const employee of DEMO_EMPLOYEES) {
    await prisma.employee.upsert({
      where: { companyId_document: { companyId, document: employee.document } },
      update: {},
      create: {
        companyId,
        name: employee.name,
        document: employee.document,
        email: employee.email,
        status: employee.status,
        departmentId: departments.get(employee.department),
        positionId: positions.get(employee.position),
      },
    });
  }
}

const DEMO_ASSET_CATEGORIES = ["Eletrônico", "Ferramenta", "Veículo", "EPI"];
const DEMO_MANUFACTURERS = ["Dell", "Bosch"];
const DEMO_SUPPLIER = { corporateName: "Fornecedor Central Ltda", tradeName: "Fornecedor Central" };

const DEMO_ASSETS = [
  {
    name: "Notebook Dell Latitude 7440",
    assetCode: "NB-001",
    category: "Eletrônico",
    manufacturer: "Dell",
    trackingMode: "INDIVIDUAL" as const,
    status: "Em uso",
    condition: "Bom",
    defaultUnit: "un",
  },
  {
    name: "Furadeira Bosch GSB550",
    assetCode: "FRD-001",
    category: "Ferramenta",
    manufacturer: "Bosch",
    trackingMode: "INDIVIDUAL" as const,
    status: "Disponível",
    condition: "Novo",
    defaultUnit: "un",
  },
  {
    name: "Luva Nitrílica",
    assetCode: "LUV-001",
    category: "EPI",
    manufacturer: undefined,
    trackingMode: "CONSUMABLE" as const,
    status: "Disponível",
    condition: "Novo",
    defaultUnit: "par",
  },
];

async function seedAssetLookups(companyId: string) {
  // AssetCategory não tem @@unique([companyId, name]) no schema atual —
  // idempotência via findFirst/create em vez de upsert.
  const categories = new Map<string, string>();
  for (const name of DEMO_ASSET_CATEGORIES) {
    const existing = await prisma.assetCategory.findFirst({ where: { companyId, name } });
    const category = existing ?? (await prisma.assetCategory.create({ data: { companyId, name } }));
    categories.set(name, category.id);
  }

  const manufacturers = new Map<string, string>();
  for (const name of DEMO_MANUFACTURERS) {
    const existing = await prisma.manufacturer.findFirst({ where: { companyId, name } });
    const manufacturer = existing ?? (await prisma.manufacturer.create({ data: { companyId, name } }));
    manufacturers.set(name, manufacturer.id);
  }

  const existingSupplier = await prisma.supplier.findFirst({
    where: { companyId, corporateName: DEMO_SUPPLIER.corporateName },
  });
  const supplier =
    existingSupplier ?? (await prisma.supplier.create({ data: { companyId, ...DEMO_SUPPLIER } }));

  // Status/Condição são compartilhados com toda empresa (não só a demo) via
  // provisionDefaultAssetStatusesAndConditions — ver lib/asset-lookup-provisioning.ts.
  const { statuses: statusRecords, conditions: conditionRecords } =
    await provisionDefaultAssetStatusesAndConditions(companyId);
  const statuses = new Map(Array.from(statusRecords, ([name, record]) => [name, record.id]));
  const conditions = new Map(Array.from(conditionRecords, ([name, record]) => [name, record.id]));

  return { categories, manufacturers, supplier, statuses, conditions };
}

async function seedAssets(companyId: string) {
  const { categories, manufacturers, supplier, statuses, conditions } =
    await seedAssetLookups(companyId);

  for (const asset of DEMO_ASSETS) {
    const existing = await prisma.asset.findFirst({
      where: { companyId, assetCode: asset.assetCode },
    });
    if (existing) continue;

    await prisma.asset.create({
      data: {
        companyId,
        name: asset.name,
        assetCode: asset.assetCode,
        categoryId: categories.get(asset.category)!,
        manufacturerId: asset.manufacturer ? manufacturers.get(asset.manufacturer) : undefined,
        supplierId: supplier.id,
        statusId: statuses.get(asset.status)!,
        conditionId: conditions.get(asset.condition)!,
        trackingMode: asset.trackingMode,
        defaultUnit: asset.defaultUnit,
      },
    });
  }
}

async function seedStockSetup(companyId: string) {
  // Local padrão + tipos de movimentação agora são compartilhados com toda
  // empresa (não só a demo) via provisionDefaultStockSetup — ver
  // lib/stock-setup-provisioning.ts.
  const { location, movementTypes: movementTypeRecords } = await provisionDefaultStockSetup(companyId);
  const movementTypes = new Map(
    Array.from(movementTypeRecords, ([name, record]) => [name, record.id]),
  );
  return { location, movementTypes };
}

/**
 * Registro de estoque demo (entrada de consumível) só para a tela /stock não
 * abrir vazia — os demais dados devem vir do fluxo real (POST
 * /api/stock/entries), este é só um ponto de partida.
 */
async function seedDemoStockEntry(companyId: string, locationId: string, movementTypeId: string) {
  const asset = await prisma.asset.findFirst({ where: { companyId, assetCode: "LUV-001" } });
  if (!asset) return;

  const existingBalance = await prisma.stockBalance.findUnique({
    where: { assetId_locationId: { assetId: asset.id, locationId } },
  });
  if (existingBalance) return;

  await prisma.$transaction([
    prisma.stockBalance.create({
      data: { companyId, assetId: asset.id, locationId, quantity: 50 },
    }),
    prisma.stockMovement.create({
      data: {
        companyId,
        assetId: asset.id,
        movementTypeId,
        quantity: 50,
        destinationLocationId: locationId,
        executedAt: new Date(),
        observations: "Estoque inicial (seed)",
      },
    }),
  ]);
}

/**
 * Sincroniza o catálogo de permissões/papéis padrão em TODAS as empresas já
 * existentes — não só a demo. `provisionDefaultRolesForCompany` é idempotente
 * (upsert), então isso é seguro de rodar sempre: sempre que `lib/permissions.ts`
 * ganha uma permissão nova, rodar o seed de novo propaga ela para quem já
 * tinha empresa cadastrada (ex.: via /register), sem precisar recriar nada.
 */
async function backfillPermissionsForAllCompanies() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const company of companies) {
    await provisionDefaultRolesForCompany(company.id);
  }
  return companies.length;
}

// Remedia empresas que se cadastraram (via /register) antes de
// provisionDefaultAssetStatusesAndConditions existir — sem isso, elas
// ficariam permanentemente sem Status/Condição e sem conseguir cadastrar
// ativos (não há mais tela para criar esses dois cadastros).
async function backfillAssetLookupsForAllCompanies() {
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const company of companies) {
    await provisionDefaultAssetStatusesAndConditions(company.id);
  }
  return companies.length;
}

// Mesma remediação, agora para local padrão de estoque + tipos de
// movimentação — empresas cadastradas antes de provisionDefaultStockSetup
// existir ficariam sem conseguir dar entrada de estoque nem entregar/
// devolver custódia.
async function backfillStockSetupForAllCompanies() {
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const company of companies) {
    await provisionDefaultStockSetup(company.id);
  }
  return companies.length;
}

async function main() {
  const company = await seedCompany();
  const roles = await provisionDefaultRolesForCompany(company.id);
  const admin = await seedAdminUser(company.id, roles.get(SYSTEM_ROLES.ADMIN)!.id);
  const roleDemoUsers = await seedRoleDemoUsers(company.id, roles);
  await seedEmployees(company.id);
  await seedAssets(company.id);
  const { location, movementTypes } = await seedStockSetup(company.id);
  await seedDemoStockEntry(company.id, location.id, movementTypes.get("ENTRY")!);
  const companyCount = await backfillPermissionsForAllCompanies();
  const lookupCompanyCount = await backfillAssetLookupsForAllCompanies();
  const stockSetupCompanyCount = await backfillStockSetupForAllCompanies();

  console.log("Seed concluído:");
  console.log(`  Company: ${company.name} (${company.id})`);
  console.log(`  Admin:   ${admin.email} / senha: ${DEMO_ADMIN_PASSWORD}`);
  for (const user of roleDemoUsers) {
    console.log(`  Demo:    ${user.email} / senha: ${DEMO_ADMIN_PASSWORD}`);
  }
  console.log(`  Roles:   ${Object.values(SYSTEM_ROLES).join(", ")}`);
  console.log(`  Colaboradores demo: ${DEMO_EMPLOYEES.length}`);
  console.log(`  Ativos demo: ${DEMO_ASSETS.length}`);
  console.log(`  Local padrão: ${location.name}`);
  console.log(`  Permissões sincronizadas em ${companyCount} empresa(s)`);
  console.log(`  Status/Condição sincronizados em ${lookupCompanyCount} empresa(s)`);
  console.log(`  Local/tipos de movimentação sincronizados em ${stockSetupCompanyCount} empresa(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
