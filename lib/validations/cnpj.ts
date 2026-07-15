import { z } from "zod";

import { isValidCnpj } from "@/lib/cnpj";

// Schema reutilizável de CNPJ (Sprint SST 1.4A, §7) — usado por qualquer
// endpoint Zod que receba CNPJ no body, para não duplicar a mesma sequência
// de mensagens em cada rota. A normalização final (`normalizeCnpj`) sempre
// acontece de novo no servidor, no service que consome o valor já validado
// aqui — este schema nunca aceita nem confia em `documentNormalized` vindo
// do client (o campo nem existe no shape aceito).
export const cnpjSchema = z
  .string()
  .trim()
  .min(1, "Informe o CNPJ.")
  .refine(isValidCnpj, "Informe um CNPJ válido.");
