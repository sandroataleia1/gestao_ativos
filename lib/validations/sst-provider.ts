import { z } from "zod";

import { cnpjSchema } from "@/lib/validations/cnpj";

export const SST_PROVIDER_ACCESS_LEVEL_VALUES = ["VIEW", "OPERATION", "ADMINISTRATION"] as const;
export const SST_PROVIDER_LINK_STATUS_UPDATE_VALUES = ["ACTIVE", "SUSPENDED", "REVOKED", "REJECTED"] as const;

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
// momento da criação do vínculo). `accessLevel` é opcional e só tem efeito
// quando `status: "ACTIVE"` (Sprint Comercial SST 1.4, §14 — a empresa
// escolhe o nível de acesso no momento da aprovação); ignorado para
// suspender/revogar/recusar, que nunca mudam o nível já registrado.
export const sstProviderLinkStatusUpdateSchema = z.object({
  status: z.enum(SST_PROVIDER_LINK_STATUS_UPDATE_VALUES),
  accessLevel: z.enum(SST_PROVIDER_ACCESS_LEVEL_VALUES).optional(),
});

export type SstProviderLinkStatusUpdateInput = z.infer<typeof sstProviderLinkStatusUpdateSchema>;

// Sprint Comercial SST 1.4 — pré-cadastro de empresa e solicitação de
// autorização a partir do CNPJ (Portal Consultoria). Nunca aceita
// `providerId`/`companyId`/`controlStatus`/`origin`/`createdByProviderId`/
// `accessLevel`/`status` no body — mesmo que o client mande, o schema só
// reconhece os campos abaixo (qualquer campo extra é ignorado pelo Zod por
// padrão, nunca repassado ao service).
export const sstCompanyCheckCnpjSchema = z.object({
  cnpj: cnpjSchema,
});
export type SstCompanyCheckCnpjInput = z.infer<typeof sstCompanyCheckCnpjSchema>;

export const sstCompanyPreRegisterSchema = z.object({
  cnpj: cnpjSchema,
  name: z.string().trim().min(1, "Informe o nome da empresa."),
});
export type SstCompanyPreRegisterInput = z.infer<typeof sstCompanyPreRegisterSchema>;

export const sstCompanyRequestAccessSchema = z.object({
  cnpj: cnpjSchema,
});
export type SstCompanyRequestAccessInput = z.infer<typeof sstCompanyRequestAccessSchema>;
