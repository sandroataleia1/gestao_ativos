import { z } from "zod";

export const TRAINING_ATTENDANCE_STATUS_VALUES = ["ENROLLED", "PRESENT", "ABSENT"] as const;
export const TRAINING_RESULT_STATUS_VALUES = ["PENDING", "APPROVED", "FAILED"] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalIsoDateTime = z.preprocess(emptyToUndefined, z.coerce.date().optional());

// Aceita employeeIds (preferido, permite adicionar vários de uma vez) ou
// employeeId (um só) no mesmo payload — ver POST
// /api/training-classes/[id]/participants.
export const trainingParticipantAddSchema = z
  .object({
    employeeIds: z.array(z.string().min(1)).optional(),
    employeeId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .refine((data) => Boolean(data.employeeIds?.length) || Boolean(data.employeeId), {
    message: "Selecione ao menos um colaborador.",
    path: ["employeeIds"],
  });

export type TrainingParticipantAddInput = z.infer<typeof trainingParticipantAddSchema>;

// Atualização parcial — diferente do padrão full-replace de CompanyTraining/
// TrainingClass: a UI dispara ações separadas (marcar presença, marcar
// resultado, editar observação), então cada campo só é alterado quando
// presente no payload (ver lib/training-participants.ts
// buildParticipantUpdateData).
export const trainingParticipantUpdateSchema = z.object({
  attendanceStatus: z.enum(TRAINING_ATTENDANCE_STATUS_VALUES).optional(),
  resultStatus: z.enum(TRAINING_RESULT_STATUS_VALUES).optional(),
  completedAt: optionalIsoDateTime,
  notes: optionalText(2000),
});

export type TrainingParticipantUpdateInput = z.infer<typeof trainingParticipantUpdateSchema>;
