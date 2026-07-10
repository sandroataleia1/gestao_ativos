import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/api-errors";

// Leitura de colaboradores para o Portal Consultoria — deliberadamente um
// arquivo separado de lib/employees.ts: o formato de retorno aqui é status
// de treinamento por colaborador, não dados cadastrais completos (a
// consultoria nunca cria/edita/inativa Employee, ver docs/portal-consultoria.md).

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_WINDOW_DAYS = 30;

export type SstEmployeeTrainingStatus = "EM_DIA" | "ATENCAO" | "PENDENTE";

/**
 * Classificação por colaborador — mesmo raciocínio de
 * classifySstComplianceStatus (lib/sst-dashboard.ts), mas com rótulo
 * "PENDENTE" em vez de "CRITICA" (linguagem da tela de colaboradores, ver
 * requisito seção 7) — não é um valor a mais do mesmo enum de empresa, é um
 * enum próprio de granularidade de colaborador.
 */
export function classifyEmployeeTrainingStatus(counts: {
  expiredCount: number;
  expiringSoonCount: number;
  missingMandatoryCount: number;
}): SstEmployeeTrainingStatus {
  if (counts.expiredCount > 0 || counts.missingMandatoryCount > 0) return "PENDENTE";
  if (counts.expiringSoonCount > 0) return "ATENCAO";
  return "EM_DIA";
}

export type SstCompanyEmployeesPageParams = {
  page: number;
  pageSize: number;
  search?: string;
};

/**
 * Página de colaboradores ATIVOS da empresa, com contadores de treinamento
 * por colaborador — sem N+1: pagina `Employee` primeiro, depois faz só 2
 * queries adicionais para a página atual inteira (treinamentos obrigatórios
 * da empresa + participações da página), nunca uma query por colaborador.
 * Mesmo padrão de getMissingMandatoryTrainingEmployeeCount
 * (lib/sst-dashboard.ts), mas retornando o detalhe por colaborador em vez
 * de só a contagem agregada.
 */
export async function getSstCompanyEmployeesPage(
  companyId: string,
  params: SstCompanyEmployeesPageParams,
  now = new Date(),
) {
  const { page, pageSize, search } = params;

  const where: Prisma.EmployeeWhereInput = {
    companyId,
    status: "ACTIVE",
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { document: { contains: search, mode: "insensitive" as const } },
            { registration: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [employees, total] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      select: {
        id: true,
        name: true,
        document: true,
        registration: true,
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

  if (employees.length === 0) return { rows: [], total };

  const employeeIds = employees.map((employee) => employee.id);
  const soonThreshold = new Date(now.getTime() + EXPIRING_SOON_WINDOW_DAYS * DAY_MS);

  const [mandatoryTrainings, participants] = await Promise.all([
    prisma.companyTraining.findMany({
      where: { companyId, active: true, mandatory: true },
      select: { id: true },
    }),
    prisma.trainingParticipant.findMany({
      where: { companyId, employeeId: { in: employeeIds }, resultStatus: "APPROVED" },
      select: { employeeId: true, expiresAt: true, trainingClass: { select: { companyTrainingId: true } } },
    }),
  ]);
  const mandatoryTrainingIds = mandatoryTrainings.map((training) => training.id);

  const participantsByEmployee = new Map<string, typeof participants>();
  for (const participant of participants) {
    const list = participantsByEmployee.get(participant.employeeId) ?? [];
    list.push(participant);
    participantsByEmployee.set(participant.employeeId, list);
  }

  const rows = employees.map((employee) => {
    const employeeParticipants = participantsByEmployee.get(employee.id) ?? [];
    const validTrainingIds = new Set<string>();
    let validCount = 0;
    let expiredCount = 0;
    let expiringSoonCount = 0;

    for (const participant of employeeParticipants) {
      if (!participant.expiresAt || participant.expiresAt.getTime() >= now.getTime()) {
        validCount += 1;
        validTrainingIds.add(participant.trainingClass.companyTrainingId);
        if (participant.expiresAt && participant.expiresAt.getTime() <= soonThreshold.getTime()) {
          expiringSoonCount += 1;
        }
      } else {
        expiredCount += 1;
      }
    }

    const missingMandatoryCount = mandatoryTrainingIds.filter((id) => !validTrainingIds.has(id)).length;

    return {
      ...employee,
      validCount,
      expiredCount,
      expiringSoonCount,
      missingMandatoryCount,
      status: classifyEmployeeTrainingStatus({ expiredCount, expiringSoonCount, missingMandatoryCount }),
    };
  });

  return { rows, total };
}

/** Resumo de treinamentos de um único colaborador — usado pelo
 * dialog/drawer da tela de colaboradores (não pela listagem paginada, para
 * não sobrecarregar cada linha com o detalhe completo). */
export async function getEmployeeTrainingSummary(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, name: true, registration: true },
  });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");

  const participants = await prisma.trainingParticipant.findMany({
    where: { companyId, employeeId },
    select: {
      id: true,
      attendanceStatus: true,
      resultStatus: true,
      completedAt: true,
      expiresAt: true,
      trainingClass: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          companyTraining: { select: { id: true, title: true, mandatory: true } },
        },
      },
    },
    orderBy: { enrolledAt: "desc" },
  });

  return { employee, participants };
}
