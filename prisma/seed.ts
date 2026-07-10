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

// ---------------------------------------------------------------------------
// Catálogo global de modelos de treinamento (TrainingTemplate) — não é
// dado por empresa (sem companyId), roda uma vez para o banco inteiro, igual
// a ensurePermissionCatalog(). Dados coerentes mas não 100% precisos
// legalmente (ver docs/trainings-domain.md) — fáceis de editar depois.
// ---------------------------------------------------------------------------

const TRAINING_TEMPLATES: Array<{
  title: string;
  code: string;
  category: string;
  trainingType: "LEGAL" | "CORPORATE";
  nrReference?: string;
  defaultValidityMonths?: number;
  defaultWorkloadHours?: number;
  requiresCertificate: boolean;
  requiresAttendanceList: boolean;
  requiresSignature: boolean;
  requiresExam: boolean;
  minimumPassingGrade?: number;
  defaultInstructorType: "INTERNAL" | "EXTERNAL" | "BOTH";
}> = [
  {
    title: "Integração",
    code: "INTEGRACAO",
    category: "Integração",
    trainingType: "CORPORATE",
    defaultWorkloadHours: 4,
    requiresCertificate: false,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "INTERNAL",
  },
  {
    title: "NR-01 - Disposições Gerais e Gerenciamento de Riscos Ocupacionais",
    code: "NR-01",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-01",
    defaultValidityMonths: 24,
    defaultWorkloadHours: 2,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "BOTH",
  },
  {
    title: "NR-05 - CIPA",
    code: "NR-05",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-05",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 20,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-06 - Equipamento de Proteção Individual",
    code: "NR-06",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-06",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 2,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "BOTH",
  },
  {
    title: "NR-10 - Segurança em Instalações e Serviços em Eletricidade",
    code: "NR-10",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-10",
    defaultValidityMonths: 24,
    defaultWorkloadHours: 40,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-11 - Transporte, Movimentação, Armazenagem e Manuseio de Materiais",
    code: "NR-11",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-11",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 16,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-12 - Segurança no Trabalho em Máquinas e Equipamentos",
    code: "NR-12",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-12",
    defaultValidityMonths: 24,
    defaultWorkloadHours: 8,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "BOTH",
  },
  {
    title: "NR-18 - Condições de Segurança na Construção Civil",
    code: "NR-18",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-18",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 8,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-20 - Segurança e Saúde no Trabalho com Inflamáveis e Combustíveis",
    code: "NR-20",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-20",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 8,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-23 - Proteção Contra Incêndios",
    code: "NR-23",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-23",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 4,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "BOTH",
  },
  {
    title: "NR-33 - Segurança e Saúde em Espaços Confinados",
    code: "NR-33",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-33",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 16,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "NR-35 - Trabalho em Altura",
    code: "NR-35",
    category: "Segurança do Trabalho",
    trainingType: "LEGAL",
    nrReference: "NR-35",
    defaultValidityMonths: 24,
    defaultWorkloadHours: 8,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "Brigada de Incêndio",
    code: "BRIGADA",
    category: "Emergência",
    trainingType: "LEGAL",
    nrReference: "NR-23",
    defaultValidityMonths: 12,
    defaultWorkloadHours: 16,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: true,
    minimumPassingGrade: 70,
    defaultInstructorType: "EXTERNAL",
  },
  {
    title: "Primeiros Socorros",
    code: "PRIMEIROS-SOCORROS",
    category: "Emergência",
    trainingType: "CORPORATE",
    defaultValidityMonths: 24,
    defaultWorkloadHours: 8,
    requiresCertificate: true,
    requiresAttendanceList: true,
    requiresSignature: true,
    requiresExam: false,
    defaultInstructorType: "EXTERNAL",
  },
];

/**
 * Idempotente via upsert por `code` (único globalmente). No `update`,
 * resincroniza os campos descritivos (mesmo padrão de
 * ensurePermissionCatalog) — editar TRAINING_TEMPLATES e rodar o seed de
 * novo propaga a mudança. `active`/`version` não são tocados no update: uma
 * desativação manual feita direto no banco não deve ser desfeita só por
 * rodar o seed de novo.
 */
async function seedTrainingTemplates() {
  for (const template of TRAINING_TEMPLATES) {
    await prisma.trainingTemplate.upsert({
      where: { code: template.code },
      update: {
        title: template.title,
        category: template.category,
        trainingType: template.trainingType,
        nrReference: template.nrReference,
        defaultValidityMonths: template.defaultValidityMonths,
        defaultWorkloadHours: template.defaultWorkloadHours,
        requiresCertificate: template.requiresCertificate,
        requiresAttendanceList: template.requiresAttendanceList,
        requiresSignature: template.requiresSignature,
        requiresExam: template.requiresExam,
        minimumPassingGrade: template.minimumPassingGrade,
        defaultInstructorType: template.defaultInstructorType,
      },
      create: { ...template, version: 1, active: true },
    });
  }
  return TRAINING_TEMPLATES.length;
}

// ---------------------------------------------------------------------------
// Prestador SST demo — ilustra o fluxo ponta a ponta de gestão por
// consultoria externa (ver docs/sst-providers.md). Idempotente: upsert do
// vínculo por [providerId, companyId]; o provider em si usa findFirst/create
// (sem campo único além do id, mesmo padrão de seedAssetLookups).
// ---------------------------------------------------------------------------

const DEMO_SST_PROVIDER_NAME = "Consultoria SST Demo";

async function seedSstProviderDemo(companyId: string, adminUserId: string) {
  let provider = await prisma.sstProvider.findFirst({ where: { name: DEMO_SST_PROVIDER_NAME } });
  if (!provider) {
    provider = await prisma.sstProvider.create({
      data: {
        name: DEMO_SST_PROVIDER_NAME,
        document: "00.000.000/0002-00",
        email: "contato@consultoriasstdemo.com.br",
        phone: "(11) 4000-0000",
      },
    });
  }

  await prisma.sstProviderCompany.upsert({
    where: { providerId_companyId: { providerId: provider.id, companyId } },
    update: {},
    create: {
      providerId: provider.id,
      companyId,
      status: "ACTIVE",
      accessLevel: "ADMINISTRATION",
      approvedByUserId: adminUserId,
      approvedAt: new Date(),
    },
  });

  return provider;
}

/** Um CompanyTraining demo gerenciado pela consultoria (NR-33), para o
 * ambiente demo mostrar o caso de uso completo. Idempotente via findFirst
 * (CompanyTraining não tem campo único além do id). */
async function seedDemoCompanyTraining(companyId: string, providerId: string) {
  const existing = await prisma.companyTraining.findFirst({
    where: { companyId, managementMode: "EXTERNAL_PROVIDER" },
  });
  if (existing) return existing;

  const template = await prisma.trainingTemplate.findUnique({ where: { code: "NR-33" } });
  if (!template) return null;

  return prisma.companyTraining.create({
    data: {
      companyId,
      trainingTemplateId: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      trainingType: template.trainingType,
      nrReference: template.nrReference,
      validityMonths: template.defaultValidityMonths,
      workloadHours: template.defaultWorkloadHours,
      requiresCertificate: template.requiresCertificate,
      requiresAttendanceList: template.requiresAttendanceList,
      requiresSignature: template.requiresSignature,
      requiresExam: template.requiresExam,
      minimumPassingGrade: template.minimumPassingGrade,
      instructorType: template.defaultInstructorType,
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: providerId,
    },
  });
}

// ---------------------------------------------------------------------------
// Portal Consultoria SST demo — Sprint Comercial 1.1 (ver
// docs/portal-consultoria.md). Provider DISTINTO de "Consultoria SST Demo"
// acima: aquele ilustra um CompanyTraining EXTERNAL_PROVIDER do lado da
// empresa; este é o login de demonstração do próprio Portal Consultoria
// (/sst). O User criado aqui precisa de um companyId só para satisfazer a
// constraint NOT NULL do schema — isso é IRRELEVANTE para o Portal
// Consultoria, que nunca lê User.companyId (o tenant do portal é sempre
// SstProvider, via SstProviderUser/SstProviderCompany).
// ---------------------------------------------------------------------------

const SST_PORTAL_PROVIDER_NAME = "Consultoria Segura SST";
const SST_PORTAL_USER_EMAIL = "sst@demo.com";
const SST_PORTAL_USER_PASSWORD = "Demo@12345";

async function seedSstPortalDemo(companyId: string) {
  let provider = await prisma.sstProvider.findFirst({ where: { name: SST_PORTAL_PROVIDER_NAME } });
  if (!provider) {
    provider = await prisma.sstProvider.create({
      data: {
        name: SST_PORTAL_PROVIDER_NAME,
        document: "00.000.000/0003-00",
        email: "contato@consultoriaseguransst.com.br",
        phone: "(11) 4000-1111",
      },
    });
  }

  let user = await prisma.user.findUnique({ where: { email: SST_PORTAL_USER_EMAIL } });
  if (!user) {
    const result = await signUpEmailInternal({
      name: "Técnico Consultoria Segura SST",
      email: SST_PORTAL_USER_EMAIL,
      password: SST_PORTAL_USER_PASSWORD,
      companyId,
    });
    user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
  }

  await prisma.sstProviderUser.upsert({
    where: { providerId_userId: { providerId: provider.id, userId: user.id } },
    update: { active: true },
    create: { providerId: provider.id, userId: user.id, role: "OWNER", active: true },
  });

  await prisma.sstProviderCompany.upsert({
    where: { providerId_companyId: { providerId: provider.id, companyId } },
    update: {},
    create: {
      providerId: provider.id,
      companyId,
      status: "ACTIVE",
      accessLevel: "ADMINISTRATION",
      approvedByUserId: user.id,
      approvedAt: new Date(),
    },
  });

  return { provider, user };
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
  const trainingTemplateCount = await seedTrainingTemplates();
  const sstProvider = await seedSstProviderDemo(company.id, admin.id);
  await seedDemoCompanyTraining(company.id, sstProvider.id);
  const sstPortalDemo = await seedSstPortalDemo(company.id);
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
  console.log(`  Modelos de treinamento: ${trainingTemplateCount}`);
  console.log(`  Prestador SST demo: ${sstProvider.name} (vínculo ACTIVE/ADMINISTRATION)`);
  console.log(
    `  Portal Consultoria SST: ${sstPortalDemo.provider.name} — login: ${sstPortalDemo.user.email} / senha: ${SST_PORTAL_USER_PASSWORD}`,
  );
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
