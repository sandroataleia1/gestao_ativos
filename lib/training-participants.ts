import type { Prisma, TrainingClassStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit, type ActorInput } from "@/lib/audit";
import type { TrainingParticipantUpdateInput } from "@/lib/validations/training-participant";

export const participantEmployeeInclude = {
  employee: {
    select: {
      id: true,
      name: true,
      document: true,
      registration: true,
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  },
} as const;

/** Garante que cada id existe, pertence à empresa atual e está ACTIVE —
 * nunca confia apenas no formato do id vindo do client. Mesmo padrão de
 * assertReferencesBelongToCompany (lib/employees.ts) e
 * assertCompanyTrainingBelongsToCompany (lib/training-classes.ts). */
export async function assertEmployeesActiveInCompany(companyId: string, employeeIds: string[]) {
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, companyId },
    select: { id: true, status: true },
  });

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  for (const id of employeeIds) {
    const employee = employeeById.get(id);
    if (!employee) throw new ValidationError("Colaborador não encontrado.");
    if (employee.status !== "ACTIVE") {
      throw new ValidationError("Colaborador inativo não pode ser adicionado a novas turmas.");
    }
  }
}

type ParticipantAction = "add" | "remove" | "record";

const STATUS_ERROR_MESSAGES: Record<ParticipantAction, Partial<Record<TrainingClassStatus, string>>> = {
  add: {
    COMPLETED: "Não é possível adicionar participantes em turma concluída.",
    CANCELLED: "Não é possível alterar participantes de uma turma cancelada.",
  },
  remove: {
    IN_PROGRESS: "Não é possível remover participante após início da turma.",
    COMPLETED: "Não é possível remover participante após início da turma.",
    CANCELLED: "Não é possível alterar participantes de uma turma cancelada.",
  },
  record: {
    SCHEDULED: "Só é possível registrar presença/resultado depois que a turma começar.",
    CANCELLED: "Não é possível alterar participantes de uma turma cancelada.",
  },
};

const ALLOWED_STATUS: Record<ParticipantAction, TrainingClassStatus[]> = {
  add: ["SCHEDULED", "IN_PROGRESS"],
  remove: ["SCHEDULED"],
  record: ["IN_PROGRESS", "COMPLETED"],
};

/** Centraliza a tabela de "portas de status" — quais ações sobre
 * participantes são permitidas conforme o status da turma. Ver
 * docs/trainings-domain.md. */
export function assertTrainingClassAllows(status: TrainingClassStatus, action: ParticipantAction) {
  if (ALLOWED_STATUS[action].includes(status)) return;
  throw new ValidationError(STATUS_ERROR_MESSAGES[action][status] ?? "Ação não permitida para o status atual da turma.");
}

/**
 * Adiciona um ou mais participantes a uma turma — valida colaboradores
 * fora da transação (não depende de lock), depois abre uma transação que
 * trava a linha da `TrainingClass` (`SELECT ... FOR UPDATE`) antes de ler
 * status/capacidade e inserir. O lock serializa duas chamadas concorrentes
 * sobre a MESMA turma — sem ele, duas transações em Read Committed (padrão
 * do Postgres) poderiam ambas contar a mesma capacidade disponível antes de
 * qualquer uma commitar, estourando `maximumParticipants`. Turmas
 * diferentes não se bloqueiam entre si. Ver docs/training-architecture.md
 * para o paralelo com o UPDATE condicional atômico já usado em
 * app/api/custodies/deliver/route.ts (mesmo princípio, aplicado de forma
 * diferente porque aqui a capacidade é derivada de um COUNT(*), não de uma
 * coluna contadora).
 */
export async function addParticipants(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  employeeIds: string[],
) {
  const uniqueEmployeeIds = [...new Set(employeeIds)];
  await assertEmployeesActiveInCompany(companyId, uniqueEmployeeIds);

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: TrainingClassStatus; maximumParticipants: number | null }[]>`
      SELECT "status", "maximumParticipants" FROM "TrainingClass" WHERE id = ${trainingClassId} FOR UPDATE
    `;
    const trainingClass = locked[0];
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    assertTrainingClassAllows(trainingClass.status, "add");

    const [existingParticipants, currentCount] = await Promise.all([
      tx.trainingParticipant.findMany({
        where: { trainingClassId, employeeId: { in: uniqueEmployeeIds } },
        select: { employeeId: true },
      }),
      tx.trainingParticipant.count({ where: { trainingClassId } }),
    ]);

    if (existingParticipants.length > 0) {
      throw new ConflictError("Colaborador já está nesta turma.");
    }

    if (
      trainingClass.maximumParticipants !== null &&
      currentCount + uniqueEmployeeIds.length > trainingClass.maximumParticipants
    ) {
      throw new ConflictError("A turma atingiu a capacidade máxima.");
    }

    await tx.trainingParticipant.createMany({
      data: uniqueEmployeeIds.map((employeeId) => ({
        companyId,
        trainingClassId,
        employeeId,
      })),
    });

    const participants = await tx.trainingParticipant.findMany({
      where: { trainingClassId, employeeId: { in: uniqueEmployeeIds } },
      include: participantEmployeeInclude,
    });

    for (const participant of participants) {
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: actor.actorType,
        providerId: actor.providerId,
        action: "training_participant.add",
        targetType: "TrainingParticipant",
        targetId: participant.id,
        targetLabel: participant.employee.name,
        metadata: { trainingClassId },
      });
    }

    return participants;
  });
}

/** Remoção real (não soft-delete): só permitida quando a turma ainda nem
 * começou (SCHEDULED). Registra `training_participant.remove`. */
export async function removeParticipant(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  participantId: string,
) {
  const participant = await prisma.trainingParticipant.findFirst({
    where: { id: participantId, trainingClassId, companyId },
    include: { ...participantEmployeeInclude, trainingClass: { select: { status: true } } },
  });
  if (!participant) throw new NotFoundError("Participante não encontrado.");

  assertTrainingClassAllows(participant.trainingClass.status, "remove");

  return prisma.$transaction(async (tx) => {
    await tx.trainingParticipant.delete({ where: { id: participantId } });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_participant.remove",
      targetType: "TrainingParticipant",
      targetId: participantId,
      targetLabel: participant.employee.name,
      metadata: { trainingClassId },
    });
  });
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Monta o `data` de atualização de um participante — só toca nos campos
 * presentes no payload (atualização parcial, ver
 * lib/validations/training-participant.ts). Quando `resultStatus` vira
 * APPROVED ou FAILED, `completedAt` é setado (input.completedAt ou `now()`)
 * — marca quando a avaliação terminou, em ambos os casos; `expiresAt` só é
 * calculado para APPROVED (`completedAt` + `validityMonths` meses, `null`
 * se `validityMonths` for nulo/zero). Voltar para PENDING reseta os dois.
 */
export function buildParticipantUpdateData(
  input: TrainingParticipantUpdateInput,
  validityMonths: number | null,
): Prisma.TrainingParticipantUncheckedUpdateInput {
  const data: Prisma.TrainingParticipantUncheckedUpdateInput = {};

  if (input.attendanceStatus !== undefined) data.attendanceStatus = input.attendanceStatus;
  if (input.notes !== undefined) data.notes = input.notes;

  if (input.resultStatus !== undefined) {
    data.resultStatus = input.resultStatus;

    if (input.resultStatus === "APPROVED") {
      const completedAt = input.completedAt ?? new Date();
      data.completedAt = completedAt;
      data.expiresAt = validityMonths ? addMonths(completedAt, validityMonths) : null;
    } else if (input.resultStatus === "FAILED") {
      data.completedAt = input.completedAt ?? new Date();
      data.expiresAt = null;
    } else {
      data.completedAt = null;
      data.expiresAt = null;
    }
  } else if (input.completedAt !== undefined) {
    data.completedAt = input.completedAt;
  }

  return data;
}

/** Registra presença/resultado/observação de um participante — atualização
 * parcial (só os campos presentes no payload). Registra
 * `training_participant.attendance_update` e/ou
 * `training_participant.result_update` conforme os campos que de fato
 * mudaram (atualizações só de `notes` não geram log — ação não prevista). */
export async function updateParticipant(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  participantId: string,
  input: TrainingParticipantUpdateInput,
) {
  const participant = await prisma.trainingParticipant.findFirst({
    where: { id: participantId, trainingClassId, companyId },
    include: {
      ...participantEmployeeInclude,
      trainingClass: { select: { status: true, companyTraining: { select: { validityMonths: true } } } },
    },
  });
  if (!participant) throw new NotFoundError("Participante não encontrado.");

  assertTrainingClassAllows(participant.trainingClass.status, "record");

  const data = buildParticipantUpdateData(input, participant.trainingClass.companyTraining.validityMonths);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.trainingParticipant.update({
      where: { id: participantId },
      data,
      include: participantEmployeeInclude,
    });

    if (input.attendanceStatus !== undefined) {
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: actor.actorType,
        providerId: actor.providerId,
        action: "training_participant.attendance_update",
        targetType: "TrainingParticipant",
        targetId: participantId,
        targetLabel: updated.employee.name,
        metadata: { attendanceStatus: input.attendanceStatus },
      });
    }

    if (input.resultStatus !== undefined) {
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: actor.actorType,
        providerId: actor.providerId,
        action: "training_participant.result_update",
        targetType: "TrainingParticipant",
        targetId: participantId,
        targetLabel: updated.employee.name,
        metadata: { resultStatus: input.resultStatus, expiresAt: updated.expiresAt },
      });
    }

    return updated;
  });
}

export function isParticipantExpired(expiresAt: Date | null, now = new Date()) {
  return Boolean(expiresAt && expiresAt.getTime() < now.getTime());
}

/** Lista completa (sem paginação — uma turma tem no máximo algumas dezenas
 * de participantes), ordenada por nome do colaborador. */
export async function getParticipantsForClass(companyId: string, trainingClassId: string) {
  return prisma.trainingParticipant.findMany({
    where: { companyId, trainingClassId },
    include: participantEmployeeInclude,
    orderBy: { employee: { name: "asc" } },
  });
}
