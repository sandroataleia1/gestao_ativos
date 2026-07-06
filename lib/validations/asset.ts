import { z } from "zod";

import { certificationInputSchema } from "@/lib/validations/certification";

export const TRACKING_MODE_VALUES = ["INDIVIDUAL", "CONSUMABLE"] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalDecimal = z.preprocess(
  emptyToUndefined,
  z.coerce.number().nonnegative("Deve ser um número positivo.").optional(),
);

const optionalInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative("Deve ser um número inteiro positivo.").optional(),
);

export const assetInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  assetCode: z.string().trim().min(1, "Informe o código/SKU.").max(64),
  description: optionalText(2000),
  categoryId: z.string().min(1, "Selecione uma categoria."),
  manufacturerId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  supplierId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  statusId: z.string().min(1, "Selecione um status."),
  conditionId: z.string().min(1, "Selecione uma condição."),
  trackingMode: z.enum(TRACKING_MODE_VALUES),
  defaultUnit: optionalText(16),
  barcode: optionalText(64),
  minimumStock: optionalDecimal,
  maximumStock: optionalDecimal,
  reorderPoint: optionalDecimal,
  purchasePrice: optionalDecimal,
  replacementCost: optionalDecimal,
  expectedLifetime: optionalInt,
  warrantyMonths: optionalInt,
  active: z.boolean().default(true),
  // Opcional: cria (sem `id`) ou atualiza (com `id`) uma certificação do
  // ativo junto com o próprio Asset — ver lib/certifications e
  // docs/certifications.md. Omitir o campo não mexe nas certificações
  // existentes.
  certification: certificationInputSchema.optional(),
});

export type AssetInput = z.infer<typeof assetInputSchema>;
