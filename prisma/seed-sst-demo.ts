import "dotenv/config";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { formatCnpj, normalizeCnpj, withValidCheckDigits } from "@/lib/cnpj";

// Seed dedicado de demonstração comercial do Portal Consultoria SST (Sprint
// Demo Comercial SST 1.0, Parte 10) — separado de prisma/seed.ts de
// propósito: cria SEMPRE as mesmas 5 empresas fictícias com situações de
// conformidade variadas, sem depender de dados já existentes no banco além
// do catálogo global de TrainingTemplate (opcional — usa se existir, cria a
// própria CompanyTraining sem template caso contrário).
//
// Idempotente: toda entidade é localizada por uma chave estável (nome,
// documento, ou combinação única do schema) antes de criar — rodar de novo
// nunca duplica. Nunca toca em "Empresa Demo"/outras empresas do banco:
// todo nome de empresa criado aqui termina em "(Demo SST)", o que também é
// a chave usada por reset-sst-demo.ts para apagar só o que este script criou.
//
// Uso:
//   npm run db:seed-sst-demo          — cria/atualiza os dados de demo
//   npm run db:reset-sst-demo         — apaga e recria do zero

const PROVIDER_NAME = "Consultoria Segura SST";
const DEMO_PASSWORD = "Demo@12345";

// Nomes humanos fictícios (Sprint Demo Comercial SST 1.2/1.3) — o nome
// anterior ("Técnico Consultoria Segura SST") misturava papel + nome da
// consultoria e parecia um dado técnico/artificial na demonstração. Só o
// nome muda aqui; os e-mails continuam no padrão já usado pelo projeto
// (`<papel>@demo.com`, igual a `admin@demo.com` do seed principal) — trocar
// e-mail também exigiria migrar contas já semeadas em outros ambientes sem
// nenhum ganho de apresentação real.
const OWNER_EMAIL = "sst@demo.com";
const OWNER_NAME = "Mariana Costa";
const TECHNICIAN_EMAIL = "sst-tech@demo.com";
const TECHNICIAN_NAME = "Rafael Almeida";
const VIEWER_EMAIL = "sst-viewer@demo.com";
const VIEWER_NAME = "Juliana Santos";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

function monthsAgo(months: number, from = new Date()) {
  return new Date(from.getTime() - months * MONTH_MS);
}
function daysFromNow(days: number, from = new Date()) {
  return new Date(from.getTime() + days * DAY_MS);
}

async function ensureProvider() {
  const existing = await prisma.sstProvider.findFirst({ where: { name: PROVIDER_NAME } });
  if (existing) return existing;
  return prisma.sstProvider.create({
    data: {
      name: PROVIDER_NAME,
      document: "00.000.000/0003-00",
      email: "contato@consultoriaseguransst.com.br",
      phone: "(11) 4000-1111",
    },
  });
}

/** Cria o usuário de portal se não existir — `companyId` só satisfaz a FK
 * NOT NULL legada de User; NUNCA cria CompanyMembership aqui (isso daria
 * acesso ao Portal Empresa, fora do escopo desta sprint — ver Parte 3).
 *
 * Sempre força a senha de demonstração (`DEMO_PASSWORD`) na conta
 * "credential", mesmo se o usuário já existia — sem isso, um e-mail que já
 * tivesse sido criado antes deste script existir (ou com senha alterada
 * manualmente) ficaria com uma senha desconhecida, e "resetar e semear de
 * novo" não garantiria o login documentado no roteiro (achado na
 * verificação de credenciais da Sprint Demo Comercial SST 1.1).
 *
 * Também sincroniza `name` a cada execução (Sprint Demo Comercial SST 1.3,
 * achado durante a validação de idempotência): sem isso, um banco semeado
 * antes de uma troca de nome (ex.: "Técnico Consultoria Segura SST" ->
 * "Mariana Costa") ficaria preso ao nome antigo mesmo depois de
 * `db:reset-sst-demo` + `db:seed-sst-demo`, porque o usuário já existe e era
 * só devolvido como estava. */
async function ensurePortalUser(email: string, name: string, anchorCompanyId: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const result = await signUpEmailInternal({ name, email, password: DEMO_PASSWORD, companyId: anchorCompanyId });
    user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
  } else if (user.name !== name) {
    user = await prisma.user.update({ where: { id: user.id }, data: { name } });
  }

  const hashedPassword = await hashPassword(DEMO_PASSWORD);
  const existingAccount = await prisma.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
  if (existingAccount) {
    await prisma.account.update({ where: { id: existingAccount.id }, data: { password: hashedPassword } });
  } else {
    await prisma.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: hashedPassword },
    });
  }

  return user;
}

async function ensureProviderUser(providerId: string, userId: string, role: "OWNER" | "TECHNICIAN" | "VIEWER") {
  return prisma.sstProviderUser.upsert({
    where: { providerId_userId: { providerId, userId } },
    update: { active: true },
    create: { providerId, userId, role, active: true },
  });
}

// CNPJs fictícios porém matematicamente válidos (Sprint Comercial SST 1.4,
// §19) — antes cada empresa usava o placeholder "00.000.000/000X-00", que
// falhava a validação de dígito verificador. Determinísticos (mesma base
// numérica sempre gera o mesmo CNPJ) e nunca reaproveitados de nenhuma
// empresa real conhecida.
function fictionalCnpj(base12: string): string {
  return formatCnpj(withValidCheckDigits(base12));
}

async function ensureCompany(name: string, document: string) {
  const existing = await prisma.company.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.company.create({
    data: { name, document, documentType: "CNPJ", documentOriginal: document, documentNormalized: normalizeCnpj(document) },
  });
}

async function ensureProviderCompanyLink(providerId: string, companyId: string, approvedByUserId: string) {
  return prisma.sstProviderCompany.upsert({
    where: { providerId_companyId: { providerId, companyId } },
    update: { status: "ACTIVE" },
    create: {
      providerId,
      companyId,
      status: "ACTIVE",
      accessLevel: "OPERATION",
      approvedByUserId,
      approvedAt: new Date(),
    },
  });
}

async function ensureDepartment(companyId: string, name: string) {
  return prisma.department.upsert({
    where: { companyId_name: { companyId, name } },
    update: {},
    create: { companyId, name },
  });
}

async function ensurePosition(companyId: string, name: string) {
  return prisma.position.upsert({
    where: { companyId_name: { companyId, name } },
    update: {},
    create: { companyId, name },
  });
}

async function ensureEmployee(
  companyId: string,
  departmentId: string,
  positionId: string,
  input: { name: string; document: string; registration: string },
) {
  return prisma.employee.upsert({
    where: { companyId_document: { companyId, document: input.document } },
    update: {},
    create: { companyId, departmentId, positionId, status: "ACTIVE", ...input },
  });
}

async function ensureCompanyTraining(
  companyId: string,
  providerId: string,
  input: { title: string; nrReference: string; validityMonths: number; mandatory: boolean },
) {
  const existing = await prisma.companyTraining.findFirst({ where: { companyId, title: input.title } });
  if (existing) return existing;
  return prisma.companyTraining.create({
    data: {
      companyId,
      title: input.title,
      trainingType: "LEGAL",
      nrReference: input.nrReference,
      validityMonths: input.validityMonths,
      mandatory: input.mandatory,
      requiresCertificate: true,
      requiresAttendanceList: true,
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: providerId,
      active: true,
    },
  });
}

async function ensureTrainingClass(
  companyId: string,
  companyTrainingId: string,
  input: { title: string; status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED"; startsAt: Date; endsAt?: Date | null },
) {
  const existing = await prisma.trainingClass.findFirst({ where: { companyId, companyTrainingId, title: input.title } });
  if (existing) return existing;
  return prisma.trainingClass.create({
    data: {
      companyId,
      companyTrainingId,
      title: input.title,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      location: "Unidade fictícia — dado de demonstração",
      internalInstructor: "Instrutor Demo SST",
    },
  });
}

type ParticipantOutcome =
  | { kind: "APPROVED"; completedAt: Date; expiresAt: Date | null }
  | { kind: "NONE" };

async function ensureParticipant(
  companyId: string,
  trainingClassId: string,
  employeeId: string,
  outcome: ParticipantOutcome,
) {
  if (outcome.kind === "NONE") return null;
  return prisma.trainingParticipant.upsert({
    where: { companyId_trainingClassId_employeeId: { companyId, trainingClassId, employeeId } },
    update: {},
    create: {
      companyId,
      trainingClassId,
      employeeId,
      attendanceStatus: "PRESENT",
      resultStatus: "APPROVED",
      completedAt: outcome.completedAt,
      expiresAt: outcome.expiresAt,
      notes: "Registro fictício — dado de demonstração comercial.",
    },
  });
}

type EmployeeSeed = { name: string; document: string; registration: string };

function demoDocument(companyIndex: number, employeeIndex: number) {
  // CPF claramente fictício (todos zeros + índices) — nunca um CPF real.
  return `000.000.${String(companyIndex).padStart(2, "0")}${String(employeeIndex).padStart(1, "0")}-00`;
}

async function seedGoodComplianceCompany(providerId: string, approvedByUserId: string) {
  const company = await ensureCompany("Metalúrgica Alfa (Demo SST)", fictionalCnpj("000000000009"));
  await ensureProviderCompanyLink(providerId, company.id, approvedByUserId);

  const dept = await ensureDepartment(company.id, "Produção");
  const pos = await ensurePosition(company.id, "Operador de Produção");

  const employees: EmployeeSeed[] = [
    { name: "Carlos Fictício Alfa", document: demoDocument(9, 1), registration: "A-001" },
    { name: "Beatriz Fictícia Alfa", document: demoDocument(9, 2), registration: "A-002" },
    { name: "Diego Fictício Alfa", document: demoDocument(9, 3), registration: "A-003" },
    { name: "Elaine Fictícia Alfa", document: demoDocument(9, 4), registration: "A-004" },
  ];

  const training = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-12 - Segurança no Trabalho em Máquinas e Equipamentos",
    nrReference: "NR-12",
    validityMonths: 24,
    mandatory: true,
  });

  const trainingClass = await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-12 — Concluída",
    status: "COMPLETED",
    startsAt: monthsAgo(2),
    endsAt: monthsAgo(2),
  });

  for (const employeeSeed of employees) {
    const employee = await ensureEmployee(company.id, dept.id, pos.id, employeeSeed);
    const completedAt = monthsAgo(2);
    await ensureParticipant(company.id, trainingClass.id, employee.id, {
      kind: "APPROVED",
      completedAt,
      expiresAt: new Date(completedAt.getTime() + 24 * MONTH_MS),
    });
  }

  return company;
}

async function seedMissingMandatoryCompany(providerId: string, approvedByUserId: string) {
  const company = await ensureCompany("Construtora Beta (Demo SST)", fictionalCnpj("000000000010"));
  await ensureProviderCompanyLink(providerId, company.id, approvedByUserId);

  const dept = await ensureDepartment(company.id, "Obras");
  const pos = await ensurePosition(company.id, "Pedreiro");

  const employees: EmployeeSeed[] = [
    { name: "Fábio Fictício Beta", document: demoDocument(10, 1), registration: "B-001" },
    { name: "Gabriela Fictícia Beta", document: demoDocument(10, 2), registration: "B-002" },
    { name: "Hugo Fictício Beta", document: demoDocument(10, 3), registration: "B-003" },
    { name: "Isabela Fictícia Beta", document: demoDocument(10, 4), registration: "B-004" },
    { name: "João Fictício Beta", document: demoDocument(10, 5), registration: "B-005" },
  ];

  const training = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-18 - Condições de Segurança na Construção Civil",
    nrReference: "NR-18",
    validityMonths: 12,
    mandatory: true,
  });

  const trainingClass = await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-18 — Concluída",
    status: "COMPLETED",
    startsAt: monthsAgo(3),
    endsAt: monthsAgo(3),
  });

  for (const [index, employeeSeed] of employees.entries()) {
    const employee = await ensureEmployee(company.id, dept.id, pos.id, employeeSeed);
    // Só os 2 primeiros concluíram o treinamento — os outros 3 ficam sem
    // nenhum TrainingParticipant válido, gerando missingMandatoryCount = 3.
    if (index < 2) {
      const completedAt = monthsAgo(3);
      await ensureParticipant(company.id, trainingClass.id, employee.id, {
        kind: "APPROVED",
        completedAt,
        expiresAt: new Date(completedAt.getTime() + 12 * MONTH_MS),
      });
    }
  }

  return company;
}

async function seedExpiringSoonCompany(providerId: string, approvedByUserId: string) {
  const company = await ensureCompany("Transportadora Gama (Demo SST)", fictionalCnpj("000000000011"));
  await ensureProviderCompanyLink(providerId, company.id, approvedByUserId);

  const dept = await ensureDepartment(company.id, "Logística");
  const pos = await ensurePosition(company.id, "Motorista");

  const employees: EmployeeSeed[] = [
    { name: "Kléber Fictício Gama", document: demoDocument(11, 1), registration: "G-001" },
    { name: "Larissa Fictícia Gama", document: demoDocument(11, 2), registration: "G-002" },
    { name: "Marcos Fictício Gama", document: demoDocument(11, 3), registration: "G-003" },
    { name: "Natália Fictícia Gama", document: demoDocument(11, 4), registration: "G-004" },
  ];

  const training = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-11 - Transporte, Movimentação, Armazenagem e Manuseio de Materiais",
    nrReference: "NR-11",
    validityMonths: 12,
    mandatory: true,
  });

  // Concluída há ~11 meses e meio — validade de 12 meses vence dentro da
  // janela de 30 dias usada por getExpiryCounts (lib/sst-dashboard.ts).
  const completedAt = monthsAgo(11.5);
  const trainingClass = await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-11 — Concluída",
    status: "COMPLETED",
    startsAt: completedAt,
    endsAt: completedAt,
  });

  const expiresAt = daysFromNow(12);
  for (const employeeSeed of employees) {
    const employee = await ensureEmployee(company.id, dept.id, pos.id, employeeSeed);
    await ensureParticipant(company.id, trainingClass.id, employee.id, {
      kind: "APPROVED",
      completedAt,
      expiresAt,
    });
  }

  return company;
}

async function seedFutureClassCompany(providerId: string, approvedByUserId: string) {
  const company = await ensureCompany("Indústria Delta (Demo SST)", fictionalCnpj("000000000012"));
  await ensureProviderCompanyLink(providerId, company.id, approvedByUserId);

  const dept = await ensureDepartment(company.id, "Manutenção");
  const pos = await ensurePosition(company.id, "Técnico de Manutenção");

  const employees: EmployeeSeed[] = [
    { name: "Otávio Fictício Delta", document: demoDocument(12, 1), registration: "D-001" },
    { name: "Patrícia Fictícia Delta", document: demoDocument(12, 2), registration: "D-002" },
    { name: "Rodrigo Fictício Delta", document: demoDocument(12, 3), registration: "D-003" },
  ];

  const pastTraining = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-10 - Segurança em Instalações e Serviços em Eletricidade",
    nrReference: "NR-10",
    validityMonths: 24,
    mandatory: true,
  });
  const pastClass = await ensureTrainingClass(company.id, pastTraining.id, {
    title: "Turma NR-10 — Concluída",
    status: "COMPLETED",
    startsAt: monthsAgo(4),
    endsAt: monthsAgo(4),
  });

  for (const employeeSeed of employees) {
    const employee = await ensureEmployee(company.id, dept.id, pos.id, employeeSeed);
    const completedAt = monthsAgo(4);
    await ensureParticipant(company.id, pastClass.id, employee.id, {
      kind: "APPROVED",
      completedAt,
      expiresAt: new Date(completedAt.getTime() + 24 * MONTH_MS),
    });
  }

  // Treinamento diferente com turma agendada no futuro — ilustra "turmas
  // agendadas" no dashboard e a visão da empresa. NÃO obrigatório de
  // propósito: o cenário desta empresa é "boa conformidade + turma
  // futura" — se fosse mandatory, os 3 colaboradores virariam "sem
  // treinamento obrigatório" só por a turma ainda não ter acontecido,
  // contaminando o índice de conformidade e duplicando o cenário de
  // Construtora Beta.
  const futureTraining = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-35 - Trabalho em Altura",
    nrReference: "NR-35",
    validityMonths: 24,
    mandatory: false,
  });
  await ensureTrainingClass(company.id, futureTraining.id, {
    title: "Turma NR-35 — Agendada",
    status: "SCHEDULED",
    startsAt: daysFromNow(10),
    endsAt: daysFromNow(10),
  });

  return company;
}

async function seedMixedPendencyCompany(providerId: string, approvedByUserId: string) {
  const company = await ensureCompany("Comércio Épsilon (Demo SST)", fictionalCnpj("000000000013"));
  await ensureProviderCompanyLink(providerId, company.id, approvedByUserId);

  const dept = await ensureDepartment(company.id, "Loja");
  const pos = await ensurePosition(company.id, "Vendedor");

  const employees: EmployeeSeed[] = [
    { name: "Simone Fictícia Épsilon", document: demoDocument(13, 1), registration: "E-001" },
    { name: "Tiago Fictício Épsilon", document: demoDocument(13, 2), registration: "E-002" },
    { name: "Úrsula Fictícia Épsilon", document: demoDocument(13, 3), registration: "E-003" },
    { name: "Vinícius Fictício Épsilon", document: demoDocument(13, 4), registration: "E-004" },
    { name: "Wagner Fictício Épsilon", document: demoDocument(13, 5), registration: "E-005" },
  ];

  const training = await ensureCompanyTraining(company.id, providerId, {
    title: "NR-23 - Proteção Contra Incêndios",
    nrReference: "NR-23",
    validityMonths: 12,
    mandatory: true,
  });

  const oldClass = await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-23 — Concluída (vencida)",
    status: "COMPLETED",
    startsAt: monthsAgo(14),
    endsAt: monthsAgo(14),
  });

  const employeeRecords = [];
  for (const employeeSeed of employees) {
    employeeRecords.push(await ensureEmployee(company.id, dept.id, pos.id, employeeSeed));
  }

  // employeeRecords[0..1]: treinamento vencido (concluído há 14 meses, validade 12).
  for (const employee of employeeRecords.slice(0, 2)) {
    const completedAt = monthsAgo(14);
    await ensureParticipant(company.id, oldClass.id, employee.id, {
      kind: "APPROVED",
      completedAt,
      expiresAt: new Date(completedAt.getTime() + 12 * MONTH_MS),
    });
  }
  // employeeRecords[2..3]: nenhum treinamento — sem treinamento obrigatório.
  // employeeRecords[4]: em dia (concluído recentemente).
  const recentEmployee = employeeRecords[4];
  const recentClass = await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-23 — Concluída (recente)",
    status: "COMPLETED",
    startsAt: monthsAgo(1),
    endsAt: monthsAgo(1),
  });
  const recentCompletedAt = monthsAgo(1);
  await ensureParticipant(company.id, recentClass.id, recentEmployee.id, {
    kind: "APPROVED",
    completedAt: recentCompletedAt,
    expiresAt: new Date(recentCompletedAt.getTime() + 12 * MONTH_MS),
  });

  // Turma em andamento neste momento — ilustra "turmas em andamento" no
  // dashboard (nenhuma outra empresa demo tem uma).
  await ensureTrainingClass(company.id, training.id, {
    title: "Turma NR-23 — Em andamento",
    status: "IN_PROGRESS",
    startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  return company;
}

// Exportado (não só chamado no rodapé) para permitir cobertura de teste real
// de idempotência (tests/tenant-isolation/sst-demo-seed.test.ts chama esta
// função duas vezes contra o banco de testes e verifica que não duplica).
export async function seedSstDemo() {
  console.log("Seed de demonstração — Portal Consultoria SST");

  const provider = await ensureProvider();

  // Âncora DEDICADA para o User.companyId (campo legado, NOT NULL) dos 3
  // usuários de portal — de propósito uma empresa à parte das 5 empresas de
  // cenário (nome sem o sufixo "(Demo SST)"), nunca removida por
  // reset-sst-demo.ts. Se a âncora fosse uma das 5 empresas de cenário, o
  // reset excluiria a empresa mas manteria os usuários (o script nunca
  // apaga sst@demo.com/sst-tech@demo.com/sst-viewer@demo.com), violando a
  // FK User.companyId — foi exatamente esse bug que o teste de idempotência
  // pegou (ver tests/tenant-isolation/sst-dashboard-scope-and-seed.test.ts,
  // caso 20).
  const anchorCompany = await ensureCompany(
    "Consultoria Segura SST — Acesso ao Portal (não remover)",
    fictionalCnpj("000000000008"),
  );

  const ownerUser = await ensurePortalUser(OWNER_EMAIL, OWNER_NAME, anchorCompany.id);
  await ensureProviderUser(provider.id, ownerUser.id, "OWNER");

  const technicianUser = await ensurePortalUser(TECHNICIAN_EMAIL, TECHNICIAN_NAME, anchorCompany.id);
  await ensureProviderUser(provider.id, technicianUser.id, "TECHNICIAN");

  const viewerUser = await ensurePortalUser(VIEWER_EMAIL, VIEWER_NAME, anchorCompany.id);
  await ensureProviderUser(provider.id, viewerUser.id, "VIEWER");

  await seedGoodComplianceCompany(provider.id, ownerUser.id);
  await seedMissingMandatoryCompany(provider.id, ownerUser.id);
  await seedExpiringSoonCompany(provider.id, ownerUser.id);
  await seedFutureClassCompany(provider.id, ownerUser.id);
  await seedMixedPendencyCompany(provider.id, ownerUser.id);

  console.log("Concluído. Contas de demonstração (Portal Consultoria):");
  console.log(`  OWNER:      ${OWNER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  TECHNICIAN: ${TECHNICIAN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  VIEWER:     ${VIEWER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("  Senhas válidas apenas em ambiente local/demonstração — nunca em produção.");
}

// Só executa automaticamente quando rodado diretamente via CLI (`tsx
// prisma/seed-sst-demo.ts`) — importar `seedSstDemo` de um teste não deve
// disparar a seed nem desconectar o Prisma client compartilhado da suíte.
const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  seedSstDemo()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
