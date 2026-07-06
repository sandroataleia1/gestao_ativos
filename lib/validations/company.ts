import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

// Config da Evolution API (WhatsApp) desta empresa (ver lib/evolution-api.ts
// e app/(app)/configuracoes). Os 3 campos são opcionais individualmente na
// tabela, mas exigidos juntos aqui: não faz sentido salvar só a URL sem a
// API key, por exemplo — ou os 3 vêm preenchidos, ou o formulário limpa a
// configuração (ver rota, que também aceita limpar enviando tudo vazio).
export const whatsappConfigInputSchema = z
  .object({
    whatsappApiUrl: z.preprocess(emptyToUndefined, z.string().trim().url("URL inválida.").max(500).optional()),
    whatsappApiKey: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(500).optional()),
    whatsappInstanceName: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200).optional()),
  })
  .refine(
    (data) => {
      const filled = [data.whatsappApiUrl, data.whatsappApiKey, data.whatsappInstanceName].filter(Boolean);
      return filled.length === 0 || filled.length === 3;
    },
    { message: "Preencha os 3 campos, ou deixe todos em branco para remover a integração." },
  );

export type WhatsappConfigInput = z.infer<typeof whatsappConfigInputSchema>;
