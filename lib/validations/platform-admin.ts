import { z } from "zod";

// Sprint SST 1.4D, §11 — como não existe validação automática de
// representante, a decisão do Super Admin é sempre manual e sempre exige
// justificativa. Nunca aceita string vazia/só espaços; limites de tamanho
// evitam tanto uma justificativa vazia de conteúdo ("ok") quanto colar um
// documento inteiro. A checagem de senha/token é um heurístico best-effort
// (nunca uma garantia) — existe só para pegar o erro óbvio de alguém colar
// uma credencial por engano, não para validar segurança de verdade.
const REVIEW_NOTE_MIN_LENGTH = 10;
const REVIEW_NOTE_MAX_LENGTH = 1000;

export const reviewNoteSchema = z
  .string()
  .trim()
  .min(REVIEW_NOTE_MIN_LENGTH, `A justificativa deve ter pelo menos ${REVIEW_NOTE_MIN_LENGTH} caracteres.`)
  .max(REVIEW_NOTE_MAX_LENGTH, `A justificativa deve ter no máximo ${REVIEW_NOTE_MAX_LENGTH} caracteres.`)
  .refine((value) => !/(senha|password|token|secret)\s*[:=]/i.test(value), {
    message: "A justificativa não pode conter senha, token ou segredo.",
  });

// §11 — "opções simples", sem upload de documento nesta sprint.
export const VERIFICATION_METHOD_VALUES = [
  "BUSINESS_CONTACT_CONFIRMED",
  "EXTERNALLY_VERIFIED_DOCUMENTATION",
  "INTERNAL_ANALYSIS",
  "OTHER",
] as const;

export const platformAdminDecisionSchema = z.object({
  reviewNote: reviewNoteSchema,
  verificationMethod: z.enum(VERIFICATION_METHOD_VALUES).optional(),
});

export type PlatformAdminDecisionInput = z.infer<typeof platformAdminDecisionSchema>;
