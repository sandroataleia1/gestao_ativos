import { z } from "zod";

export const SST_PROVIDER_ACCESS_LEVEL_VALUES = ["VIEW", "OPERATION", "ADMINISTRATION"] as const;
export const SST_PROVIDER_LINK_STATUS_UPDATE_VALUES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;

// Vincula um SstProvider JÁ EXISTENTE (encontrado por busca — ver
// GET /api/sst-providers/search) — nunca cria um SstProvider novo pela tela
// da empresa. `providerId` é revalidado no servidor (existe, está `active`,
// ainda não tem vínculo com esta empresa) antes de criar o
// SstProviderCompany (status: PENDING).
export const sstProviderLinkCreateSchema = z.object({
  providerId: z.string().trim().min(1, "Selecione um prestador."),
  accessLevel: z.enum(SST_PROVIDER_ACCESS_LEVEL_VALUES),
});

export type SstProviderLinkCreateInput = z.infer<typeof sstProviderLinkCreateSchema>;

// PENDING não é um estado para o qual se volta manualmente (só existe no
// momento da criação do vínculo).
export const sstProviderLinkStatusUpdateSchema = z.object({
  status: z.enum(SST_PROVIDER_LINK_STATUS_UPDATE_VALUES),
});

export type SstProviderLinkStatusUpdateInput = z.infer<typeof sstProviderLinkStatusUpdateSchema>;
