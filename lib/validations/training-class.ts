import { z } from "zod";

export const TRAINING_CLASS_STATUS_VALUES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

// `null` tratado como "vazio" igual à string vazia — necessário porque o
// fluxo de cancelamento (SST e Portal Empresa) reenvia os campos opcionais
// tal como vêm do Prisma (TrainingClass.location/instructor/notes são
// `string | null`, nunca `undefined`); sem isso, `z.string().optional()`
// rejeita `null` com "Invalid input: expected string, received null" e o
// cancelamento falha silenciosamente (bug real encontrado na validação
// manual da Sprint Demo Comercial SST 1.0 — a mesma rota é usada pela
// tabela de turmas do Portal Empresa, então também corrigido lá).
const emptyToUndefined = (value: unknown) =>
  value === null || (typeof value === "string" && value.trim() === "") ? undefined : value;

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
