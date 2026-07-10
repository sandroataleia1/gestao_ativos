import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Mesmo conjunto de campos já usado em `supplierInputSchema`
// (lib/validations/asset-lookups.ts) — reaproveitado aqui em vez de
// inventar um formato de endereço novo.
export const companyProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Informe a razão social.").max(200),
  tradeName: optionalText(200),
  document: optionalText(32),
  email: z.preprocess(emptyToUndefined, z.email("Informe um email válido.").optional()),
  phone: optionalText(32),
  address: optionalText(255),
  city: optionalText(100),
  state: optionalText(2),
  zipCode: optionalText(16),
  responsibleName: optionalText(200),
  // Data URL de imagem — validado por regex (defesa em profundidade, já que
  // este valor vira um `<img src>` dentro do termo de custódia em
  // lib/custodies/index.ts). `null` explícito remove a logo; ausente não
  // altera o valor atual.
  logoDataUrl: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(400_000, "Logo muito grande.")
      .regex(/^data:image\/(png|jpe?g|webp);base64,/, "Formato de imagem inválido.")
      .optional()
      .nullable(),
  ),
});

export type CompanyProfileInput = z.infer<typeof companyProfileInputSchema>;
