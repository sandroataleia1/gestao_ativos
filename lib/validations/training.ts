import { z } from "zod";

export const TRAINING_TYPE_VALUES = ["LEGAL", "CORPORATE"] as const;
export const INSTRUCTOR_TYPE_VALUES = ["INTERNAL", "EXTERNAL", "BOTH"] as const;
export const TRAINING_MANAGEMENT_MODE_VALUES = ["INTERNAL", "EXTERNAL_PROVIDER"] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative("Deve ser um número inteiro positivo.").optional(),
);

// Usado tanto na criação (POST) quanto na edição (PUT) — PUT substitui o
// recurso inteiro, mesmo padrão de employeeInputSchema/assetInputSchema.
export const companyTrainingInputSchema = z.object({
  // Só relevante no POST (escolha do modelo de origem) — o servidor copia os
  // campos reais do template na hora de criar, nunca confia em campos do
  // client que "deveriam" bater com o template (ver lib/trainings.ts
  // buildCompanyTrainingCreateData). Ignorado no PUT: trainingTemplateId é
  // imutável depois de criado.
  trainingTemplateId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  title: z.string().trim().min(1, "Informe o título.").max(200),
  description: optionalText(2000),
  category: optionalText(100),
  trainingType: z.enum(TRAINING_TYPE_VALUES),
  nrReference: optionalText(32),
  validityMonths: optionalInt,
  workloadHours: optionalInt,
  requiresCertificate: z.boolean().default(true),
  requiresAttendanceList: z.boolean().default(true),
  requiresSignature: z.boolean().default(false),
  requiresExam: z.boolean().default(false),
  minimumPassingGrade: optionalInt,
  instructorType: z.enum(INSTRUCTOR_TYPE_VALUES).default("BOTH"),
  mandatory: z.boolean().default(false),
  active: z.boolean().default(true),
  // Quem gerencia o treinamento — validado de verdade (provider ativo,
  // vínculo ACTIVE, accessLevel OPERATION/ADMINISTRATION) em
  // assertManagementModeValid (lib/trainings.ts), nunca só pela forma do
  // payload. Em INTERNAL, managedByProviderId é sempre forçado a null no
  // servidor, independente do que vier aqui.
  managementMode: z.enum(TRAINING_MANAGEMENT_MODE_VALUES).default("INTERNAL"),
  managedByProviderId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type CompanyTrainingInput = z.infer<typeof companyTrainingInputSchema>;
