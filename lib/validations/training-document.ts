import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

// Mesma forma de lib/validations/custody-document.ts — POST
// /api/training-classes/[id]/documents aceita um dos dois shapes conforme
// `type`.
export const trainingClassDocumentInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ATTENDANCE_LIST") }),
  z.object({ type: z.literal("CERTIFICATE"), participantId: z.string().min(1, "Selecione um participante.") }),
]);

export type TrainingClassDocumentInput = z.infer<typeof trainingClassDocumentInputSchema>;

// Aceita imagem (upload futuro) ou dados de canvas (o normal hoje) — pelo
// menos um dos dois é obrigatório, mesmo padrão de custodySignatureInputSchema.
export const trainingAttendanceSignatureInputSchema = z
  .object({
    participantId: z.string().min(1, "Participante inválido."),
    signerName: z.string().trim().min(1, "Informe o nome do assinante.").max(200),
    signerDocument: z.string().trim().min(1, "Informe o documento do assinante.").max(50),
    signatureImageUrl: z.preprocess(emptyToUndefined, z.string().url().max(2000).optional()),
    signatureData: z.preprocess(emptyToUndefined, z.string().min(1).max(2_000_000).optional()),
  })
  .refine((data) => Boolean(data.signatureImageUrl || data.signatureData), {
    message: "Informe a assinatura (imagem ou dados do canvas).",
    path: ["signatureData"],
  });

export type TrainingAttendanceSignatureInput = z.infer<typeof trainingAttendanceSignatureInputSchema>;
