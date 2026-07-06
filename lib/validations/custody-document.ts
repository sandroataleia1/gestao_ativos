import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const CUSTODY_DOCUMENT_TYPES = ["DELIVERY_TERM", "RETURN_TERM"] as const;
export type CustodyDocumentType = (typeof CUSTODY_DOCUMENT_TYPES)[number];

export const custodyDocumentInputSchema = z.object({
  type: z.enum(CUSTODY_DOCUMENT_TYPES),
});

export type CustodyDocumentInput = z.infer<typeof custodyDocumentInputSchema>;

// Aceita imagem (upload futuro) ou dados de canvas (o normal hoje) — pelo
// menos um dos dois é obrigatório, verificado no `.refine` abaixo.
export const custodySignatureInputSchema = z
  .object({
    documentId: z.string().min(1, "Documento inválido."),
    signerName: z.string().trim().min(1, "Informe o nome do assinante.").max(200),
    signerDocument: z.string().trim().min(1, "Informe o documento do assinante.").max(50),
    signatureImageUrl: z.preprocess(emptyToUndefined, z.string().url().max(2000).optional()),
    signatureData: z.preprocess(emptyToUndefined, z.string().min(1).max(2_000_000).optional()),
  })
  .refine((data) => Boolean(data.signatureImageUrl || data.signatureData), {
    message: "Informe a assinatura (imagem ou dados do canvas).",
    path: ["signatureData"],
  });

export type CustodySignatureInput = z.infer<typeof custodySignatureInputSchema>;
