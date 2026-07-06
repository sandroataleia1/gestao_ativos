import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

// Fotos: data URL base64 (mesmo padrão de CustodySignature.signatureData) —
// o client já comprime/redimensiona antes de enviar (ver
// components/custody/photo-picker.tsx). Até 5 por evento (entrega ou
// devolução), cada uma limitada a ~2MB em base64 (~1.5MB de imagem real)
// para não permitir payloads abusivos.
const custodyPhotosSchema = z
  .array(z.string().min(1).max(2_000_000))
  .max(5, "No máximo 5 fotos.")
  .optional();

// Aceita os dois modos de entrega no mesmo payload — qual campo é
// obrigatório (quantity vs. assetUnitId) é decidido no route handler depois
// de olhar o `trackingMode` real do Asset no banco (nunca confiamos no que o
// client diz).
export const custodyDeliverInputSchema = z.object({
  employeeId: z.string().min(1, "Selecione um colaborador."),
  assetId: z.string().min(1, "Selecione um ativo."),
  assetUnitId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  quantity: z.preprocess(
    emptyToUndefined,
    z.coerce.number().positive("A quantidade deve ser maior que zero.").optional(),
  ),
  deliveredAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  expectedReturnAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  reason: optionalText(255),
  notes: optionalText(1000),
  photos: custodyPhotosSchema,
  // A assinatura em si nunca é capturada neste request — o formulário de
  // entrega só decide COMO o colaborador vai assinar depois (ver
  // app/assinar/[token]): "QR" gera o termo e mostra um QR Code na hora,
  // para o colaborador ler e assinar no próprio celular ali mesmo; "WHATSAPP"
  // faz o mesmo, mas envia o link por WhatsApp (Evolution API) em vez de
  // mostrar o QR. Omitido = entrega sem fluxo de assinatura nenhum.
  signatureDelivery: z.enum(["QR", "WHATSAPP"]).optional(),
});

export type CustodyDeliverInput = z.infer<typeof custodyDeliverInputSchema>;

// Payload do POST público em app/api/signature-requests/[token] — nome e
// documento do assinante nunca vêm do client (mesma decisão já tomada para a
// assinatura presencial): são sempre lidos do colaborador da própria
// custódia no servidor.
export const signatureRequestSignSchema = z.object({
  signatureData: z.string().min(1, "Capture a assinatura.").max(2_000_000),
});

export const CUSTODY_RETURN_DESTINATIONS = ["STOCK", "DISCARD"] as const;
export type CustodyReturnDestination = (typeof CUSTODY_RETURN_DESTINATIONS)[number];

export const custodyReturnInputSchema = z.object({
  custodyId: z.string().min(1, "Selecione uma custódia."),
  conditionId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  destination: z.enum(CUSTODY_RETURN_DESTINATIONS).default("STOCK"),
  returnedAt: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  notes: optionalText(1000),
  photos: custodyPhotosSchema,
});

export type CustodyReturnInput = z.infer<typeof custodyReturnInputSchema>;
