import type { SstProviderCompanyAccessLevel, SstProviderCompanyStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Métricas de conformidade de treinamento para o Portal Consultoria SST —
// calculadas sob demanda a partir de CompanyTraining/TrainingClass/
// TrainingParticipant/Employee, no mesmo espírito de lib/alerts.ts (que
// hoje NÃO cobre treinamentos). Nada aqui é persistido; não existe tabela
// de alertas/indicadores. Ver docs/portal-consultoria.md.

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_WINDOW_DAYS = 30;

const SCORE_PENALTY_EXPIRED = 10;
const SCORE_PENALTY_MISSING_MANDATORY = 15;
const SCORE_PENALTY_EXPIRING_SOON = 5;

export type SstComplianceStatus = "EM_DIA" | "ATENCAO" | "CRITICA";

export type SstComplianceCounts = {
  expiredCount: number;
  missingMandatoryCount: number;
  expiringSoonCount: number;
};

/**
 * Nota MVP de conformidade (0-100): base 100, com penalidades por
 * treinamento vencido, colaborador sem treinamento obrigatório e
 * treinamento vencendo em 30 dias. Fórmula inicial, sujeita a refinamento
 * — ver limitações em docs/portal-consultoria.md.
 */
export function calculateSstComplianceScore(counts: SstComplianceCounts): number {
  const raw =
    100 -
    counts.expiredCount * SCORE_PENALTY_EXPIRED -
    counts.missingMandatoryCount * SCORE_PENALTY_MISSING_MANDATORY -
    counts.expiringSoonCount * SCORE_PENALTY_EXPIRING_SOON;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Classificação Em dia / Atenção / Crítica — regra de negócio direta
 * (independente da nota numérica de `calculateSstComplianceScore`):
 * crítica se existe treinamento vencido OU colaborador sem treinamento
 * obrigatório; atenção se existem treinamentos vencendo em 30 dias; em dia
 * caso contrário. Exibida lado a lado com a nota, não derivada dela — ver
 * docs/portal-consultoria.md ("nota vs. status").
 */
export function classifySstComplianceStatus(counts: SstComplianceCounts): SstComplianceStatus {
  if (counts.expiredCount > 0 || counts.missingMandatoryCount > 0) return "CRITICA";
  if (counts.expiringSoonCount > 0) return "ATENCAO";
  return "EM_DIA";
}

async function getExpiryCounts(companyId: string, now: Date) {
  const soonThreshold = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * DAY_MS);
  const [expiredCount, expiringSoonCount] = await Promise.all([
    prisma.trainingParticipant.count({
      where: { companyId, resultStatus: "APPROVED", expiresAt: { lt: now } },
    }),
    prisma.trainingParticipant.count({
      where: { companyId, resultStatus: "APPROVED", expiresAt: { gte: now, lte: soonThreshold } },
    }),
  ]);
  return { expiredCount, expiringSoonCount };
}

/**
 * Conta colaboradores ATIVOS que não têm, para PELO MENOS UM treinamento
 * obrigatório (CompanyTraining active+mandatory), um TrainingParticipant
 * válido (resultStatus APPROVED e expiresAt nulo ou futuro). Contado uma
 * vez por colaborador, não por par colaborador×treinamento — decisão
 * registrada em docs/portal-consultoria.md, consistente com a penalidade
 * de -15 "por colaborador" da nota de conformidade.
 */
export async function getMissingMandatoryTrainingEmployeeCount(
  companyId: string,
  now = new Date(),
): Promise<number> {
  const [activeEmployees, mandatoryTrainings] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true } }),
    prisma.companyTraining.findMany({
      where: { companyId, active: true, mandatory: true },
      select: { id: true },
    }),
  ]);
  if (activeEmployees.length === 0 || mandatoryTrainings.length === 0) return 0;

  const mandatoryTrainingIds = mandatoryTrainings.map((t) => t.id);
  const employeeIds = activeEmployees.map((e) => e.id);

  const validParticipants = await prisma.trainingParticipant.findMany({
    where: {
      companyId,
      employeeId: { in: employeeIds },
      resultStatus: "APPROVED",
      trainingClass: { companyTrainingId: { in: mandatoryTrainingIds } },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    select: { employeeId: true, trainingClass: { select: { companyTrainingId: true } } },
  });

  const validTrainingsByEmployee = new Map<string, Set<string>>();
  for (const participant of validParticipants) {
    const set = validTrainingsByEmployee.get(participant.employeeId) ?? new Set<string>();
    set.add(participant.trainingClass.companyTrainingId);
    validTrainingsByEmployee.set(participant.employeeId, set);
  }

  let missingCount = 0;
  for (const employeeId of employeeIds) {
    const validSet = validTrainingsByEmployee.get(employeeId);
    const isFullyCompliant = mandatoryTrainingIds.every((trainingId) => validSet?.has(trainingId));
    if (!isFullyCompliant) missingCount += 1;
  }
  return missingCount;
}

function getDayBounds(now: Date) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + DAY_MS);
  return { startOfDay, endOfDay };
}

function getWeekBounds(now: Date) {
  const { startOfDay } = getDayBounds(now);
  // Semana de domingo a sábado — mesma convenção simples usada nos cards do
  // dashboard existente (app/(app)/dashboard).
  const startOfWeek = new Date(startOfDay.getTime() - startOfDay.getDay() * DAY_MS);
  const endOfWeek = new Date(startOfWeek.getTime() + 7 * DAY_MS);
  return { startOfWeek, endOfWeek };
}

export type CompanyTrainingMetrics = {
  companyId: string;
  companyName: string;
  activeEmployeeCount: number;
  activeTrainingCount: number;
  scheduledClassCount: number;
  inProgressClassCount: number;
  classesTodayCount: number;
  classesThisWeekCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  missingMandatoryCount: number;
  complianceScore: number;
  complianceStatus: SstComplianceStatus;
};

export async function getCompanyTrainingMetrics(
  companyId: string,
  now = new Date(),
): Promise<CompanyTrainingMetrics> {
  const { startOfDay, endOfDay } = getDayBounds(now);
  const { startOfWeek, endOfWeek } = getWeekBounds(now);

  const [
    company,
    activeEmployeeCount,
    activeTrainingCount,
    scheduledClassCount,
    inProgressClassCount,
    classesTodayCount,
    classesThisWeekCount,
    { expiredCount, expiringSoonCount },
    missingMandatoryCount,
  ] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
    prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.companyTraining.count({ where: { companyId, active: true } }),
    prisma.trainingClass.count({ where: { companyId, status: "SCHEDULED" } }),
    prisma.trainingClass.count({ where: { companyId, status: "IN_PROGRESS" } }),
    prisma.trainingClass.count({
      where: { companyId, status: { not: "CANCELLED" }, startsAt: { gte: startOfDay, lt: endOfDay } },
    }),
    prisma.trainingClass.count({
      where: { companyId, status: { not: "CANCELLED" }, startsAt: { gte: startOfWeek, lt: endOfWeek } },
    }),
    getExpiryCounts(companyId, now),
    getMissingMandatoryTrainingEmployeeCount(companyId, now),
  ]);

  const counts = { expiredCount, expiringSoonCount, missingMandatoryCount };

  return {
    companyId,
    companyName: company.name,
    activeEmployeeCount,
    activeTrainingCount,
    scheduledClassCount,
    inProgressClassCount,
    classesTodayCount,
    classesThisWeekCount,
    expiredCount,
    expiringSoonCount,
    missingMandatoryCount,
    complianceScore: calculateSstComplianceScore(counts),
    complianceStatus: classifySstComplianceStatus(counts),
  };
}

export type SstLinkedCompanySummary = CompanyTrainingMetrics & {
  /** Nível de acesso do vínculo (SstProviderCompany.accessLevel) — exibido
   * na listagem de empresas (Sprint Demo Comercial SST 1.0, Parte 6). */
  accessLevel: SstProviderCompanyAccessLevel;
  /** Situação do relacionamento (SstProviderCompany.status) — sempre ACTIVE
   * aqui porque `getLinkedCompaniesWithMetrics` já filtra por isso, mas o
   * campo é exposto explicitamente porque a UI precisa mostrá-lo. */
  relationshipStatus: SstProviderCompanyStatus;
};

/** Empresas com vínculo ACTIVE para o provider informado — nunca lista uma
 * empresa sem vínculo ACTIVE. `providerId` deve vir sempre da sessão
 * (lib/sst-auth.ts), nunca do client. */
export async function getLinkedCompaniesWithMetrics(
  providerId: string,
  now = new Date(),
): Promise<SstLinkedCompanySummary[]> {
  const links = await prisma.sstProviderCompany.findMany({
    where: { providerId, status: "ACTIVE" },
    select: { companyId: true, accessLevel: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const metrics = await Promise.all(links.map((link) => getCompanyTrainingMetrics(link.companyId, now)));
  return metrics.map((metric, index) => ({
    ...metric,
    accessLevel: links[index].accessLevel,
    relationshipStatus: links[index].status,
  }));
}

export type SstProviderDashboardSummary = {
  companyCount: number;
  activeEmployeeCount: number;
  activeTrainingCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  missingMandatoryCount: number;
  scheduledClassCount: number;
  inProgressClassCount: number;
  classesTodayCount: number;
  classesThisWeekCount: number;
  averageComplianceScore: number;
  companiesNeedingAttention: CompanyTrainingMetrics[];
};

/**
 * Agrega `getCompanyTrainingMetrics` de cada empresa vinculada (ACTIVE) ao
 * provider. Chamar uma query por empresa é aceitável para o número de
 * empresas que uma consultoria atende hoje (dezenas); não escala para
 * centenas — ver limitações em docs/portal-consultoria.md.
 */
export async function getProviderDashboardSummary(
  providerId: string,
  now = new Date(),
): Promise<SstProviderDashboardSummary> {
  const companies = await getLinkedCompaniesWithMetrics(providerId, now);

  const companiesNeedingAttention = companies
    .filter((c) => c.complianceStatus !== "EM_DIA")
    .sort((a, b) => {
      if (a.complianceStatus === b.complianceStatus) return a.complianceScore - b.complianceScore;
      return a.complianceStatus === "CRITICA" ? -1 : 1;
    });

  if (companies.length === 0) {
    return {
      companyCount: 0,
      activeEmployeeCount: 0,
      activeTrainingCount: 0,
      expiredCount: 0,
      expiringSoonCount: 0,
      missingMandatoryCount: 0,
      scheduledClassCount: 0,
      inProgressClassCount: 0,
      classesTodayCount: 0,
      classesThisWeekCount: 0,
      averageComplianceScore: 0,
      companiesNeedingAttention: [],
    };
  }

  const sum = (select: (c: CompanyTrainingMetrics) => number) =>
    companies.reduce((total, c) => total + select(c), 0);

  return {
    companyCount: companies.length,
    activeEmployeeCount: sum((c) => c.activeEmployeeCount),
    activeTrainingCount: sum((c) => c.activeTrainingCount),
    expiredCount: sum((c) => c.expiredCount),
    expiringSoonCount: sum((c) => c.expiringSoonCount),
    missingMandatoryCount: sum((c) => c.missingMandatoryCount),
    scheduledClassCount: sum((c) => c.scheduledClassCount),
    inProgressClassCount: sum((c) => c.inProgressClassCount),
    classesTodayCount: sum((c) => c.classesTodayCount),
    classesThisWeekCount: sum((c) => c.classesThisWeekCount),
    averageComplianceScore: Math.round(sum((c) => c.complianceScore) / companies.length),
    companiesNeedingAttention,
  };
}

/** Próximas turmas agendadas da empresa — lista curta (top-N), não tabela
 * completa (UX comercial, ver docs/portal-consultoria.md). */
export async function getUpcomingClassesForCompany(companyId: string, limit = 5, now = new Date()) {
  return prisma.trainingClass.findMany({
    where: { companyId, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      companyTraining: { select: { title: true } },
    },
  });
}

/** Treinamentos obrigatórios com pelo menos um participante vencido —
 * "treinamentos críticos" da página de resumo da empresa. */
export async function getCriticalTrainingsForCompany(companyId: string, limit = 5, now = new Date()) {
  const expiredParticipants = await prisma.trainingParticipant.findMany({
    where: { companyId, resultStatus: "APPROVED", expiresAt: { lt: now } },
    select: { trainingClass: { select: { companyTrainingId: true } } },
  });

  const expiredCountByTraining = new Map<string, number>();
  for (const p of expiredParticipants) {
    const id = p.trainingClass.companyTrainingId;
    expiredCountByTraining.set(id, (expiredCountByTraining.get(id) ?? 0) + 1);
  }
  if (expiredCountByTraining.size === 0) return [];

  const trainings = await prisma.companyTraining.findMany({
    where: { id: { in: [...expiredCountByTraining.keys()] } },
    select: { id: true, title: true, mandatory: true },
  });

  return trainings
    .map((t) => ({ ...t, expiredCount: expiredCountByTraining.get(t.id) ?? 0 }))
    .sort((a, b) => b.expiredCount - a.expiredCount)
    .slice(0, limit);
}

/** Colaboradores com pelo menos um treinamento obrigatório pendente —
 * lista curta para a página de resumo da empresa. */
export async function getEmployeesWithPendingTraining(companyId: string, limit = 5, now = new Date()) {
  const [activeEmployees, mandatoryTrainings] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyTraining.findMany({
      where: { companyId, active: true, mandatory: true },
      select: { id: true },
    }),
  ]);
  if (activeEmployees.length === 0 || mandatoryTrainings.length === 0) return [];

  const mandatoryTrainingIds = mandatoryTrainings.map((t) => t.id);
  const employeeIds = activeEmployees.map((e) => e.id);

  const validParticipants = await prisma.trainingParticipant.findMany({
    where: {
      companyId,
      employeeId: { in: employeeIds },
      resultStatus: "APPROVED",
      trainingClass: { companyTrainingId: { in: mandatoryTrainingIds } },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    select: { employeeId: true, trainingClass: { select: { companyTrainingId: true } } },
  });

  const validTrainingsByEmployee = new Map<string, Set<string>>();
  for (const participant of validParticipants) {
    const set = validTrainingsByEmployee.get(participant.employeeId) ?? new Set<string>();
    set.add(participant.trainingClass.companyTrainingId);
    validTrainingsByEmployee.set(participant.employeeId, set);
  }

  const pending = activeEmployees
    .map((employee) => {
      const validSet = validTrainingsByEmployee.get(employee.id);
      const missingCount = mandatoryTrainingIds.filter((id) => !validSet?.has(id)).length;
      return { ...employee, missingMandatoryCount: missingCount };
    })
    .filter((employee) => employee.missingMandatoryCount > 0);

  return pending.slice(0, limit);
}
