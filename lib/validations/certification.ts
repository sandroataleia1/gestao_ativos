import { z } from "zod";

export const CERTIFICATION_TYPE_VALUES = ["CA", "INMETRO", "ANATEL", "ISO", "OUTROS"] as const;
export const CERTIFICATION_STATUS_VALUES = [
  "VALID",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
  "PENDING",
] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

/**
 * Campos específicos do tipo CA — guardados dentro de `metadata` (JSON) no
 * banco, não como colunas dedicadas (ver comentário em schema.prisma). Cada
 * tipo futuro (INMETRO/ANATEL/ISO) terá seu próprio formato de metadata;
 * este é só o do CA.
 */
export const caMetadataSchema = z.object({
  approvedManufacturer: optionalText(200),
  officialDescription: optionalText(2000),
  protectionType: optionalText(200),
  applicableStandard: optionalText(200),
});

export type CaMetadata = z.infer<typeof caMetadataSchema>;

// `id` presente = atualizar a certificação existente; ausente = criar nova.
export const certificationInputSchema = z.object({
  id: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  certificationType: z.enum(CERTIFICATION_TYPE_VALUES),
  certificationNumber: z.string().trim().min(1, "Informe o número da certificação."),
  issueDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  expirationDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  status: z.enum(CERTIFICATION_STATUS_VALUES).default("VALID"),
  issuer: optionalText(200),
  documentUrl: optionalText(500),
  externalId: optionalText(200),
  metadata: caMetadataSchema.optional(),
});

export type CertificationInput = z.infer<typeof certificationInputSchema>;
