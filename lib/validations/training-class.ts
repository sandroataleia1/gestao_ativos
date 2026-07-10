import { z } from "zod";

export const TRAINING_CLASS_STATUS_VALUES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive("Deve ser um número inteiro positivo.").optional(),
);

const optionalIsoDateTime = z.preprocess(emptyToUndefined, z.coerce.date().optional());

// Usado tanto na criação (POST) quanto na edição (PUT) — `status` só é
// aplicado de fato no PUT; POST sempre cria como SCHEDULED (ver
// lib/training-classes.ts).
export const trainingClassInputSchema = z
  .object({
    companyTrainingId: z.string().min(1, "Selecione um treinamento."),
    title: z.string().trim().min(1, "Informe o título da turma.").max(200),
    startsAt: z.coerce.date(),
    endsAt: optionalIsoDateTime,
    location: optionalText(200),
    internalInstructor: optionalText(200),
    externalInstructor: optionalText(200),
    maximumParticipants: optionalInt,
    notes: optionalText(2000),
    status: z.enum(TRAINING_CLASS_STATUS_VALUES).default("SCHEDULED"),
  })
  .refine((data) => !data.endsAt || data.endsAt >= data.startsAt, {
    message: "A data de término não pode ser anterior à data de início.",
    path: ["endsAt"],
  });

export type TrainingClassInput = z.infer<typeof trainingClassInputSchema>;
