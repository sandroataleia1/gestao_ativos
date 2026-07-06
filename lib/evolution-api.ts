// Cliente HTTP para a Evolution API (wrapper de WhatsApp Business
// self-hosted) — usado para enviar o link de assinatura remota do termo de
// entrega (ver app/api/custodies/deliver/route.ts e app/assinar/[token]).
// O SERVIDOR é da plataforma (EVOLUTION_API_URL/EVOLUTION_API_ADMIN_KEY, só
// no backend — ver getAdminConfig abaixo), compartilhado por todas as
// empresas; cada empresa ganha sua própria INSTÂNCIA nele (número de
// WhatsApp isolado), criada via app/(app)/configuracoes (fluxo self-service
// em app/api/company/whatsapp-instance/*) e guardada em
// Company.whatsappApiUrl/whatsappApiKey/whatsappInstanceName.

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
export type ConnectionState = "open" | "connecting" | "close";

// Config da plataforma (não da empresa) — servidor Evolution API
// compartilhado por todas as empresas, cada uma com sua própria instância
// (ver createEvolutionInstance abaixo). Só usado no backend; nunca chega ao
// browser.
function getAdminConfig(): { baseUrl: string; adminKey: string } | null {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const adminKey = process.env.EVOLUTION_API_ADMIN_KEY;
  if (!baseUrl || !adminKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), adminKey };
}

export type EvolutionInstanceResult =
  | { ok: true; apiKey: string; qrCodeBase64: string | null }
  | { ok: false; error: string };

/**
 * Cria uma instância nova (um número de WhatsApp) no servidor compartilhado
 * da plataforma — cada empresa ganha a sua, isolada por nome. Devolve a
 * "hash" que a própria Evolution API gera para essa instância específica
 * (nunca a admin key) — é isso que fica salvo em Company.whatsappApiKey daí
 * pra frente, seguindo o mesmo princípio de menor privilégio já usado no
 * envio de mensagem.
 */
export async function createEvolutionInstance(instanceName: string): Promise<EvolutionInstanceResult> {
  const config = getAdminConfig();
  if (!config) return { ok: false, error: "Integração de WhatsApp não configurada no servidor." };

  try {
    const response = await fetch(`${config.baseUrl}/instance/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.adminKey },
      body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }

    const data = await response.json();
    return { ok: true, apiKey: data.hash, qrCodeBase64: data.qrcode?.base64 ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao criar instância." };
  }
}

export type ConnectionQrResult =
  | { ok: true; state: ConnectionState; qrCodeBase64: string | null }
  | { ok: false; error: string };

/**
 * Busca (ou renova, se o QR expirou) o código de conexão de uma instância
 * já existente — o QR do Baileys expira em segundos, então o client chama
 * isso periodicamente enquanto o estado não vira "open".
 */
export async function getEvolutionConnectionQr(
  instanceName: string,
  apiKey: string,
): Promise<ConnectionQrResult> {
  const config = getAdminConfig();
  if (!config) return { ok: false, error: "Integração de WhatsApp não configurada no servidor." };

  try {
    const response = await fetch(`${config.baseUrl}/instance/connect/${instanceName}`, {
      headers: { apikey: apiKey },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }

    const data = await response.json();
    // Quando já está conectada, este endpoint não devolve `base64` — só o
    // estado real importa nesse caso (consultado à parte via
    // getEvolutionConnectionState pelo polling da tela).
    return { ok: true, state: data.base64 ? "connecting" : "open", qrCodeBase64: data.base64 ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao buscar QR Code." };
  }
}

export type ConnectionStateResult = { ok: true; state: ConnectionState } | { ok: false; error: string };

export async function getEvolutionConnectionState(
  instanceName: string,
  apiKey: string,
): Promise<ConnectionStateResult> {
  const config = getAdminConfig();
  if (!config) return { ok: false, error: "Integração de WhatsApp não configurada no servidor." };

  try {
    const response = await fetch(`${config.baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { apikey: apiKey },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }

    const data = await response.json();
    return { ok: true, state: data.instance?.state ?? "close" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao consultar status." };
  }
}

/**
 * Desconecta e remove a instância — a empresa pode reconectar depois (o
 * connect recria com o mesmo nome determinístico, já que os campos da
 * empresa são limpos junto).
 */
export async function deleteEvolutionInstance(instanceName: string): Promise<{ ok: boolean; error?: string }> {
  const config = getAdminConfig();
  if (!config) return { ok: false, error: "Integração de WhatsApp não configurada no servidor." };

  try {
    await fetch(`${config.baseUrl}/instance/logout/${instanceName}`, {
      method: "DELETE",
      headers: { apikey: config.adminKey },
    }).catch(() => null);

    const response = await fetch(`${config.baseUrl}/instance/delete/${instanceName}`, {
      method: "DELETE",
      headers: { apikey: config.adminKey },
    });

    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro desconhecido ao remover instância." };
  }
}

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
