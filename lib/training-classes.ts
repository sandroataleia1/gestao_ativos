import type { Prisma, TrainingClassStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import { logAudit, type ActorInput } from "@/lib/audit";
import type { TrainingClassInput } from "@/lib/validations/training-class";

export const TRAINING_CLASS_SORT_FIELDS = ["title", "status", "startsAt"] as const;
export type TrainingClassSortField = (typeof TRAINING_CLASS_SORT_FIELDS)[number];

function buildTrainingClassOrderBy(
  sort: TrainingClassSortField,
  dir: "asc" | "desc",
): Prisma.TrainingClassOrderByWithRelationInput {
  switch (sort) {
    case "status":
      return { status: dir };
    case "startsAt":
      return { startsAt: dir };
    default:
      return { title: dir };
  }
}

export type TrainingClassesPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  companyTrainingId?: string;
  sort: TrainingClassSortField;
  dir: "asc" | "desc";
};

/** Busca paginada/filtrada/ordenada no servidor — mesmo padrão de
 * getCompanyTrainingsPage (lib/trainings.ts). */
export async function getTrainingClassesPage(companyId: string, params: TrainingClassesPageParams) {
  const { page, pageSize, search, status, companyTrainingId, sort, dir } = params;

  const where: Prisma.TrainingClassWhereInput = {
    companyId,
    ...(status ? { status } : {}),
    ...(companyTrainingId ? { companyTrainingId } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { location: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.trainingClass.findMany({
      where,
      include: {
        companyTraining: { select: { id: true, title: true } },
        _count: { select: { participants: true } },
      },
      orderBy: buildTrainingClassOrderBy(sort, dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.trainingClass.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Garante que `companyTrainingId` existe, pertence à empresa atual e está
 * ativo — nunca confia apenas no formato do id vindo do client. Mesmo padrão
 * de validateEmployeeOrganizationReferences (lib/employees.ts).
 */
export async function assertCompanyTrainingBelongsToCompany(companyId: string, companyTrainingId: string) {
  const companyTraining = await prisma.companyTraining.findFirst({
    where: { id: companyTrainingId, companyId, active: true },
    select: { id: true },
  });
  if (!companyTraining) {
    throw new ValidationError("Treinamento inválido.");
  }
}

const DASHBOARD_UPCOMING_LIMIT = 5;

/** Painel resumo de /trainings/classes (não é o dashboard geral do app):
 * contagem por status + as próximas turmas agendadas. */
export async function getTrainingClassesDashboardSummary(companyId: string) {
  const [statusCountsRaw, upcoming] = await Promise.all([
    prisma.trainingClass.groupBy({
      by: ["status"],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.trainingClass.findMany({
      where: { companyId, status: "SCHEDULED", startsAt: { gte: new Date() } },
      include: { companyTraining: { select: { id: true, title: true } } },
      orderBy: { startsAt: "asc" },
      take: DASHBOARD_UPCOMING_LIMIT,
    }),
  ]);

  const countByStatus = new Map(statusCountsRaw.map((row) => [row.status, row._count._all]));

  return {
    scheduled: countByStatus.get("SCHEDULED") ?? 0,
    inProgress: countByStatus.get("IN_PROGRESS") ?? 0,
    completed: countByStatus.get("COMPLETED") ?? 0,
    cancelled: countByStatus.get("CANCELLED") ?? 0,
    upcoming,
  };
}

// ---------------------------------------------------------------------------
// State machine — ver docs/training-architecture.md para a tabela completa
// e a justificativa de cada decisão (em especial IN_PROGRESS→CANCELLED,
// permitida deliberadamente para não quebrar o botão "Cancelar turma" já
// existente desde a Sprint 1).
// ---------------------------------------------------------------------------

const STATUS_LABELS_PT: Record<TrainingClassStatus, string> = {
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

const ALLOWED_TRANSITIONS: Record<TrainingClassStatus, TrainingClassStatus[]> = {
  SCHEDULED: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: ["COMPLETED"],
  CANCELLED: ["CANCELLED"],
};

/**
 * Única porta de entrada para mudar o status de uma turma — nenhuma rota
 * pode escrever `status` sem passar por aqui antes (ver updateTrainingClass
 * abaixo). Identidade (current === next) é sempre permitida, para não
 * atrapalhar salvar outros campos sem mexer no status.
 */
export function assertTrainingClassTransition(current: TrainingClassStatus, next: TrainingClassStatus) {
  if (ALLOWED_TRANSITIONS[current].includes(next)) return;
  throw new ValidationError(
    `Não é possível mudar o status da turma de "${STATUS_LABELS_PT[current]}" para "${STATUS_LABELS_PT[next]}".`,
  );
}

const trainingClassInclude = { companyTraining: { select: { id: true, title: true } } } as const;

/** Cria uma turma — sempre nasce SCHEDULED (não há etapa de status no
 * wizard de criação). Registra `training_class.create`. */
export async function createTrainingClass(companyId: string, actor: ActorInput, input: TrainingClassInput) {
  await assertCompanyTrainingBelongsToCompany(companyId, input.companyTrainingId);

  return prisma.$transaction(async (tx) => {
    const trainingClass = await tx.trainingClass.create({
      data: {
        companyId,
        companyTrainingId: input.companyTrainingId,
        title: input.title,
        status: "SCHEDULED",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location,
        internalInstructor: input.internalInstructor,
        externalInstructor: input.externalInstructor,
        maximumParticipants: input.maximumParticipants,
        notes: input.notes,
      },
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_class.create",
      targetType: "TrainingClass",
      targetId: trainingClass.id,
      targetLabel: trainingClass.title,
      metadata: { companyTrainingId: trainingClass.companyTrainingId, startsAt: trainingClass.startsAt },
    });

    return trainingClass;
  });
}

/**
 * Atualiza uma turma, incluindo o status — valida a transição via
 * `assertTrainingClassTransition` antes de qualquer escrita. Registra
 * `training_class.cancel` quando o novo status é CANCELLED e o anterior não
 * era (mais específico), senão `training_class.update`.
 */
export async function updateTrainingClass(
  companyId: string,
  actor: ActorInput,
  id: string,
  currentStatus: TrainingClassStatus,
  input: TrainingClassInput,
) {
  await assertCompanyTrainingBelongsToCompany(companyId, input.companyTrainingId);
  assertTrainingClassTransition(currentStatus, input.status);

  const action =
    input.status === "CANCELLED" && currentStatus !== "CANCELLED" ? "training_class.cancel" : "training_class.update";

  return prisma.$transaction(async (tx) => {
    const trainingClass = await tx.trainingClass.update({
      where: { id },
      data: {
        companyTrainingId: input.companyTrainingId,
        title: input.title,
        status: input.status,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location,
        internalInstructor: input.internalInstructor,
        externalInstructor: input.externalInstructor,
        maximumParticipants: input.maximumParticipants,
        notes: input.notes,
      },
      include: trainingClassInclude,
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action,
      targetType: "TrainingClass",
      targetId: trainingClass.id,
      targetLabel: trainingClass.title,
      metadata: { previousStatus: currentStatus, newStatus: trainingClass.status },
    });

    return trainingClass;
  });
}
