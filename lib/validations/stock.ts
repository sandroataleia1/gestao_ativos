import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Aceita os dois modos de controle no mesmo payload — qual campo é
// obrigatório (quantity vs. serialNumbers/status/condition) é decidido no
// route handler depois de olhar o `trackingMode` real do Asset no banco
// (nunca confiamos num trackingMode vindo do client).
export const stockEntryInputSchema = z.object({
  assetId: z.string().min(1, "Selecione um ativo."),
  // Opcional agora — a UI não deixa mais escolher local (ver
  // app/(app)/stock/stock-entry-dialog.tsx); quando ausente, o route
  // handler usa o local padrão de estoque da empresa (ver
  // lib/stock-setup-provisioning.ts). Mantido aceitando o campo para não
  // quebrar chamadas existentes que ainda informem um locationId explícito.
  locationId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  quantity: z.preprocess(
    emptyToUndefined,
    z.coerce.number().positive("A quantidade deve ser maior que zero.").optional(),
  ),
  serialNumbers: z
    .array(z.string().trim().min(1, "Número de série/patrimônio não pode ser vazio."))
    .optional(),
  statusId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  conditionId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  observations: optionalText(1000),
  executedAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
});

export type StockEntryInput = z.infer<typeof stockEntryInputSchema>;
