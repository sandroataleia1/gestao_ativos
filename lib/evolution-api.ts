// Cliente HTTP para a Evolution API (wrapper de WhatsApp Business
// self-hosted) — usado para enviar o link de assinatura remota do termo de
// entrega (ver app/api/custodies/deliver/route.ts e app/assinar/[token]).
// Config é por empresa (Company.whatsappApiUrl/whatsappApiKey/
// whatsappInstanceName), nunca global: cada tenant conecta sua própria
// instância/número.

/**
 * Normaliza um telefone brasileiro (com ou sem máscara) para o formato que a
 * Evolution API espera: só dígitos, com DDI 55 na frente. Retorna `null`
 * quando não sobra nenhum dígito (campo vazio).
 */
export function normalizeWhatsAppPhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
};

export type SendWhatsAppResult = { ok: true } | { ok: false; error: string };

/**
 * Envia uma mensagem de texto simples via Evolution API
 * (`POST {baseUrl}/message/sendText/{instance}`). Nunca lança — falhas de
 * rede/HTTP viram `{ ok: false, error }` para o caller decidir o que fazer
 * (a entrega já foi criada antes desta chamada; um envio falho não deve
 * derrubar a resposta da API nem desfazer a entrega).
 */
export async function sendWhatsAppMessage(
  config: EvolutionConfig,
  phone: string,
  message: string,
): Promise<SendWhatsAppResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/message/sendText/${config.instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      body: JSON.stringify({ number: phone, text: message }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido ao enviar WhatsApp.",
    };
  }
}
