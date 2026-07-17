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
      // Sprint SST 1.4G, §9 — necessário para o badge "Colaborador inativo"
      // na listagem de participantes (o Employee pode ser inativado depois
      // de já inscrito; a inscrição em si nunca é apagada por causa disso).
      status: true,
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  },
} as const;

const MAX_BATCH_SIZE = 100;

/** Garante que cada id existe, pertence à empresa atual e está ACTIVE —
 * nunca confia apenas no formato do id vindo do client. Mesmo padrão de
 * validateEmployeeOrganizationReferences (lib/employees.ts) e
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
    IN_PROGRESS: "Os participantes não podem mais ser alterados nesta situação da turma.",
    COMPLETED: "Os participantes não podem mais ser alterados nesta situação da turma.",
    CANCELLED: "Os participantes não podem mais ser alterados nesta situação da turma.",
  },
  remove: {
    IN_PROGRESS: "Os participantes não podem mais ser alterados nesta situação da turma.",
    COMPLETED: "Os participantes não podem mais ser alterados nesta situação da turma.",
    CANCELLED: "Os participantes não podem mais ser alterados nesta situação da turma.",
  },
  record: {
    SCHEDULED: "Só é possível registrar presença/resultado depois que a turma começar.",
    CANCELLED: "Não é possível alterar participantes de uma turma cancelada.",
  },
};

// Sprint SST 1.4G, §8 — política revista: inclusão/remoção (inscrição) só
// valem para SCHEDULED. A versão anterior (Sprint 2) também permitia
// incluir participante com a turma já IN_PROGRESS ("alguém chega atrasado")
// — este spec restringe deliberadamente para escopo desta sprint (só
// inscrição, execução/presença ficam pra Sprint SST 1.4H); ver
// docs/trainings-domain.md para o registro da mudança e o motivo.
const ALLOWED_STATUS: Record<ParticipantAction, TrainingClassStatus[]> = {
  add: ["SCHEDULED"],
  remove: ["SCHEDULED"],
  record: ["IN_PROGRESS", "COMPLETED"],
};

/** Centraliza a tabela de "portas de status" — quais ações sobre
 * participantes são permitidas conforme o status da turma. Ver
 * docs/trainings-domain.md. Erro de domínio semântico (spec
 * TRAINING_CLASS_PARTICIPANTS_LOCKED): nunca revela detalhe interno, sempre
 * a mesma mensagem para add/remove bloqueados por status. */
export function assertTrainingClassAllows(status: TrainingClassStatus, action: ParticipantAction) {
  if (ALLOWED_STATUS[action].includes(status)) return;
  throw new ValidationError(STATUS_ERROR_MESSAGES[action][status] ?? "Ação não permitida para o status atual da turma.");
}

const CAPACITY_EXCEEDED_MESSAGE = "A turma não possui vagas suficientes para os participantes selecionados.";

/** Conta só as inscrições ENROLLED de uma turma — CANCELLED nunca ocupa
 * vaga. Deve ser chamada dentro da mesma transação que já travou a linha da
 * TrainingClass (SELECT ... FOR UPDATE), nunca isoladamente para decidir
 * capacidade. */
export async function countEnrolledParticipants(tx: Prisma.TransactionClient, trainingClassId: string): Promise<number> {
  return tx.trainingParticipant.count({ where: { trainingClassId, enrollmentStatus: "ENROLLED" } });
}

/** Valida que uma nova capacidade não fica abaixo da quantidade de
 * inscrições ENROLLED atuais — usada tanto pela inscrição/reativação
 * (capacidade suficiente para o aumento líquido) quanto pela edição de
 * `maximumParticipants` da turma (lib/training-classes.ts). `null` sempre
 * permitido (sem limite). Deve rodar dentro da transação que trava a linha
 * da turma. */
export async function assertCapacityAllows(
  tx: Prisma.TransactionClient,
  trainingClassId: string,
  maximumParticipants: number | null,
  additionalCount: number,
): Promise<void> {
  if (maximumParticipants === null) return;
  const currentEnrolledCount = await countEnrolledParticipants(tx, trainingClassId);
  if (currentEnrolledCount + additionalCount > maximumParticipants) {
    throw new ConflictError(CAPACITY_EXCEEDED_MESSAGE);
  }
}

/** Nova capacidade nunca pode ficar abaixo da quantidade de participantes
 * ENROLLED — CANCELLED nunca conta. Reduzir exatamente para a quantidade
 * atual é permitido; remover o limite (null) sempre é permitido. Deve
 * rodar dentro da MESMA transação que já travou a linha da turma (ver
 * lib/training-classes.ts:updateTrainingClass), para que nenhuma inscrição
 * concorrente possa ultrapassar o novo limite entre a checagem e o commit. */
export async function assertCapacityReductionAllowed(
  tx: Prisma.TransactionClient,
  trainingClassId: string,
  newMaximumParticipants: number | null | undefined,
): Promise<void> {
  if (newMaximumParticipants === null || newMaximumParticipants === undefined) return;
  const currentEnrolledCount = await countEnrolledParticipants(tx, trainingClassId);
  if (newMaximumParticipants < currentEnrolledCount) {
    throw new ValidationError("A capacidade não pode ser menor que a quantidade de participantes inscritos.");
  }
}

type LockedTrainingClass = { status: TrainingClassStatus; maximumParticipants: number | null };

async function lockTrainingClass(tx: Prisma.TransactionClient, trainingClassId: string): Promise<LockedTrainingClass> {
  const locked = await tx.$queryRaw<LockedTrainingClass[]>`
    SELECT "status", "maximumParticipants" FROM "TrainingClass" WHERE id = ${trainingClassId} FOR UPDATE
  `;
  const trainingClass = locked[0];
  if (!trainingClass) throw new NotFoundError("Turma não encontrada.");
  return trainingClass;
}

export type EnrollResult = {
  participants: Awaited<ReturnType<typeof getParticipantsForClass>>;
  created: number;
  reactivated: number;
  alreadyEnrolled: number;
  totalEnrolled: number;
  remainingCapacity: number | null;
};

/**
 * Inclui um ou mais colaboradores numa turma — idempotente e ciente de
 * reentrada (Sprint SST 1.4G, §7):
 * - Employee sem inscrição anterior nesta turma → cria ENROLLED.
 * - Employee com inscrição CANCELLED anterior → reativa a MESMA linha
 *   (nunca cria uma segunda), atualizando `enrolledAt` para agora e
 *   zerando `cancelledAt` (createdAt nunca muda — preserva a primeira
 *   inscrição histórica).
 * - Employee já ENROLLED → idempotente, sem erro, sem nova auditoria,
 *   incluído em `alreadyEnrolled` na resposta.
 * Lote é atômico: a validação de colaboradores (existência/ACTIVE) roda
 * fora da transação (não depende de lock), mas a leitura/gravação da
 * capacidade e das linhas roda inteira dentro de UMA transação que trava a
 * linha da TrainingClass (SELECT ... FOR UPDATE) — sem esse lock, duas
 * requisições concorrentes em Read Committed (padrão do Postgres)
 * poderiam ambas contar a mesma capacidade disponível antes de qualquer
 * uma comitar, estourando `maximumParticipants`. Turmas diferentes não se
 * bloqueiam entre si.
 */
export async function enrollTrainingClassParticipants(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  employeeIds: string[],
): Promise<EnrollResult> {
  const uniqueEmployeeIds = [...new Set(employeeIds)];
  if (uniqueEmployeeIds.length === 0) {
    throw new ValidationError("Selecione ao menos um colaborador.");
  }
  if (uniqueEmployeeIds.length > MAX_BATCH_SIZE) {
    throw new ValidationError(`Selecione no máximo ${MAX_BATCH_SIZE} colaboradores por vez.`);
  }
  await assertEmployeesActiveInCompany(companyId, uniqueEmployeeIds);

  return prisma.$transaction(async (tx) => {
    const trainingClass = await lockTrainingClass(tx, trainingClassId);
    assertTrainingClassAllows(trainingClass.status, "add");

    const existing = await tx.trainingParticipant.findMany({
      where: { trainingClassId, employeeId: { in: uniqueEmployeeIds } },
      select: { id: true, employeeId: true, enrollmentStatus: true },
    });

    const toCreate: string[] = [];
    const toReactivateIds: string[] = [];
    let alreadyEnrolledCount = 0;
    for (const employeeId of uniqueEmployeeIds) {
      const row = existing.find((p) => p.employeeId === employeeId);
      if (!row) toCreate.push(employeeId);
      else if (row.enrollmentStatus === "CANCELLED") toReactivateIds.push(row.id);
      else alreadyEnrolledCount += 1;
    }

    const netIncrease = toCreate.length + toReactivateIds.length;
    await assertCapacityAllows(tx, trainingClassId, trainingClass.maximumParticipants, netIncrease);

    const now = new Date();
    if (toCreate.length > 0) {
      await tx.trainingParticipant.createMany({
        data: toCreate.map((employeeId) => ({ companyId, trainingClassId, employeeId })),
      });
    }
    for (const id of toReactivateIds) {
      await tx.trainingParticipant.update({
        where: { id },
        data: { enrollmentStatus: "ENROLLED", cancelledAt: null, enrolledAt: now },
      });
    }

    const affected = await tx.trainingParticipant.findMany({
      where: { trainingClassId, employeeId: { in: uniqueEmployeeIds } },
      include: participantEmployeeInclude,
      orderBy: { employee: { name: "asc" } },
    });

    for (const participant of affected) {
      const wasCreated = toCreate.includes(participant.employeeId);
      const wasReactivated = toReactivateIds.includes(participant.id);
      if (!wasCreated && !wasReactivated) continue; // já ENROLLED — idempotente, sem auditoria nova
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: actor.actorType,
        providerId: actor.providerId,
        action: "training_participant.enroll",
        targetType: "TrainingParticipant",
        targetId: participant.id,
        targetLabel: participant.employee.name,
        metadata: { trainingClassId, reactivated: wasReactivated },
      });
    }

    const totalEnrolled = await countEnrolledParticipants(tx, trainingClassId);
    const remainingCapacity = trainingClass.maximumParticipants === null ? null : trainingClass.maximumParticipants - totalEnrolled;

    return {
      participants: affected,
      created: toCreate.length,
      reactivated: toReactivateIds.length,
      alreadyEnrolled: alreadyEnrolledCount,
      totalEnrolled,
      remainingCapacity,
    };
  });
}

/** Remoção LÓGICA (Sprint SST 1.4G, §7) — nunca apaga a linha. Marca
 * `enrollmentStatus: CANCELLED` + `cancelledAt`, preservando `enrolledAt`/
 * `createdAt` originais. Só permitida enquanto a turma ainda está
 * SCHEDULED (mesma porta de "remove" de antes). Idempotente: cancelar um
 * participante já CANCELLED é um no-op (sem nova auditoria).
 *
 * Substituiu a remoção REAL (hard delete) que existia até a Sprint SST
 * 1.4G — a versão anterior considerava aceitável apagar a linha porque a
 * turma "ainda nem tinha começado" (ver docs/trainings-domain.md); esta
 * sprint decide preservar o histórico mesmo nesse caso, para que reentrada
 * antes do início da turma reaproveite a mesma inscrição.
 */
export async function cancelTrainingClassParticipant(
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
  if (participant.enrollmentStatus === "CANCELLED") return participant;

  assertTrainingClassAllows(participant.trainingClass.status, "remove");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.trainingParticipant.update({
      where: { id: participantId },
      data: { enrollmentStatus: "CANCELLED", cancelledAt: new Date() },
      include: participantEmployeeInclude,
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_participant.cancel",
      targetType: "TrainingParticipant",
      targetId: participantId,
      targetLabel: participant.employee.name,
      metadata: { trainingClassId },
    });

    return updated;
  });
}

/** Reativa uma inscrição CANCELLED específica (reentrada explícita, a
 * partir da própria listagem de participantes — não passa pelo seletor de
 * colaboradores). Exige Employee ACTIVE, turma SCHEDULED e capacidade
 * disponível (mesmas regras de inclusão). Idempotente: reativar uma já
 * ENROLLED é um no-op. */
export async function reactivateTrainingClassParticipant(
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
  if (participant.enrollmentStatus === "ENROLLED") return participant;

  if (participant.employee.status !== "ACTIVE") {
    throw new ValidationError("Colaborador inativo não pode ser reativado nesta turma.");
  }

  return prisma.$transaction(async (tx) => {
    const trainingClass = await lockTrainingClass(tx, trainingClassId);
    assertTrainingClassAllows(trainingClass.status, "add");
    await assertCapacityAllows(tx, trainingClassId, trainingClass.maximumParticipants, 1);

    const updated = await tx.trainingParticipant.update({
      where: { id: participantId },
      data: { enrollmentStatus: "ENROLLED", cancelledAt: null, enrolledAt: new Date() },
      include: participantEmployeeInclude,
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_participant.reactivate",
      targetType: "TrainingParticipant",
      targetId: participantId,
      targetLabel: updated.employee.name,
      metadata: { trainingClassId },
    });

    return updated;
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
 * Escopo de presença/resultado é da Sprint SST 1.4H — função preservada
 * sem alteração nesta sprint.
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

/** Registra presença/resultado/observação de um participante — escopo da
 * Sprint SST 1.4H, preservado sem alteração nesta sprint. */
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
 * de participantes), ordenada por nome do colaborador. Inclui ENROLLED e
 * CANCELLED (histórico) — a UI distingue pelo badge de `enrollmentStatus`. */
export async function getParticipantsForClass(companyId: string, trainingClassId: string) {
  return prisma.trainingParticipant.findMany({
    where: { companyId, trainingClassId },
    include: participantEmployeeInclude,
    orderBy: { employee: { name: "asc" } },
  });
}

/** Resumo de vagas de uma turma — usado pelo cabeçalho da tela de
 * participantes nos dois portais (contador "X/Y", "vagas restantes"). */
export async function getTrainingClassParticipantSummary(companyId: string, trainingClassId: string) {
  const trainingClass = await prisma.trainingClass.findFirst({
    where: { id: trainingClassId, companyId },
    select: { maximumParticipants: true },
  });
  if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

  const totalEnrolled = await prisma.trainingParticipant.count({
    where: { trainingClassId, enrollmentStatus: "ENROLLED" },
  });

  return {
    maximumParticipants: trainingClass.maximumParticipants,
    totalEnrolled,
    remainingCapacity: trainingClass.maximumParticipants === null ? null : trainingClass.maximumParticipants - totalEnrolled,
  };
}

export type EligibleEmployeeRow = {
  id: string;
  name: string;
  document: string;
  registration: string | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  participantId: string | null;
  enrollmentStatus: "ENROLLED" | "CANCELLED" | null;
};

/**
 * Colaboradores ACTIVE da empresa, elegíveis para o seletor de "adicionar
 * participantes" — paginado e com busca server-side (§24 do spec: nunca
 * carregar todos os Employees de uma vez no navegador). Indica, para cada
 * um, se já tem inscrição nesta turma (ENROLLED/CANCELLED/null) para a UI
 * desenhar "já inscrito"/"reativar" sem uma segunda chamada. Documento
 * retornado aqui é sempre o valor bruto — mascarar (Portal SST) é
 * responsabilidade da rota, nunca deste serviço (mesmo padrão de
 * lib/employees.ts/lib/sst-employees.ts).
 */
export async function listEligibleEmployeesForTrainingClass(
  companyId: string,
  trainingClassId: string,
  params: { search?: string; page: number; pageSize: number },
): Promise<{ rows: EligibleEmployeeRow[]; total: number }> {
  const { search, page, pageSize } = params;

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

  const participants = await prisma.trainingParticipant.findMany({
    where: { trainingClassId, employeeId: { in: employees.map((e) => e.id) } },
    select: { id: true, employeeId: true, enrollmentStatus: true },
  });
  const participantByEmployee = new Map(participants.map((p) => [p.employeeId, p]));

  const rows = employees.map((employee) => {
    const participant = participantByEmployee.get(employee.id);
    return {
      ...employee,
      participantId: participant?.id ?? null,
      enrollmentStatus: participant?.enrollmentStatus ?? null,
    };
  });

  return { rows, total };
}
