import { z } from "zod";

export const SST_PROVIDER_ACCESS_LEVEL_VALUES = ["VIEW", "OPERATION", "ADMINISTRATION"] as const;
export const SST_PROVIDER_LINK_STATUS_UPDATE_VALUES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Cria o SstProvider e o vínculo SstProviderCompany (status: PENDING) na
// mesma chamada — não existe fluxo de buscar um provider já existente.
export const sstProviderCreateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(200),
  document: optionalText(32),
  email: z.preprocess(emptyToUndefined, z.email("Informe um email válido.").optional()),
  phone: optionalText(32),
  accessLevel: z.enum(SST_PROVIDER_ACCESS_LEVEL_VALUES),
});

export type SstProviderCreateInput = z.infer<typeof sstProviderCreateSchema>;

// PENDING não é um estado para o qual se volta manualmente (só existe no
// momento da criação do vínculo).
export const sstProviderLinkStatusUpdateSchema = z.object({
  status: z.enum(SST_PROVIDER_LINK_STATUS_UPDATE_VALUES),
});

export type SstProviderLinkStatusUpdateInput = z.infer<typeof sstProviderLinkStatusUpdateSchema>;
