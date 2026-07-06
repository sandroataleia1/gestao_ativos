import { z } from "zod";

// Cadastros de apoio de Ativo (Categoria, Fabricante, Fornecedor) — telas de
// gestão em app/(app)/cadastros. Status e Condição de ativo não têm mais
// tela própria (só seed, ver prisma/seed.ts), então não têm schema aqui.
// Todos compartilham o mesmo padrão de campo opcional (string vazia ->
// undefined) já usado em lib/validations/asset.ts.

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const assetCategoryInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  description: optionalText(500),
  color: optionalText(20),
  active: z.boolean().default(true),
});
export type AssetCategoryInput = z.infer<typeof assetCategoryInputSchema>;

// Manufacturer não tem coluna `active` (só `deletedAt`, diferente de
// AssetCategory/Supplier) — "ativo" aqui é puramente `deletedAt IS NULL`;
// não há um toggle "Ativo" no formulário.
export const manufacturerInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(150),
  document: optionalText(32),
  website: optionalText(255),
  email: optionalText(255),
  phone: optionalText(32),
});
export type ManufacturerInput = z.infer<typeof manufacturerInputSchema>;

export const supplierInputSchema = z.object({
  corporateName: z.string().trim().min(1, "Informe a razão social.").max(200),
  tradeName: optionalText(200),
  document: optionalText(32),
  stateRegistration: optionalText(32),
  municipalRegistration: optionalText(32),
  email: optionalText(255),
  phone: optionalText(32),
  contactName: optionalText(150),
  address: optionalText(255),
  city: optionalText(100),
  state: optionalText(2),
  zipCode: optionalText(16),
  notes: optionalText(1000),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;
