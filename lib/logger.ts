import pino from "pino";

// Logging estruturado (JSON), nível configurável via LOG_LEVEL (default
// "info"). `pino` porque é o padrão de fato em Node/Next.js — rápido, sem
// dependências pesadas — em vez de escrever um formatter na mão.
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Lê `x-request-id`/`x-correlation-id` (propagados por `proxy.ts` em toda
 * requisição) via `next/headers()`. Funciona só dentro de um request scope
 * (Server Component/Route Handler) — fora disso (ex.: script de seed),
 * devolve `{}` silenciosamente em vez de lançar.
 */
export async function getRequestContext(): Promise<{ requestId?: string; correlationId?: string }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      requestId: h.get("x-request-id") ?? undefined,
      correlationId: h.get("x-correlation-id") ?? undefined,
    };
  } catch {
    return {};
  }
}

async function logWithContext(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const context = await getRequestContext();
  logger[level]({ ...context, ...meta }, msg);
}

export function logInfo(msg: string, meta?: Record<string, unknown>) {
  return logWithContext("info", msg, meta);
}

export function logWarn(msg: string, meta?: Record<string, unknown>) {
  return logWithContext("warn", msg, meta);
}

export function logError(msg: string, meta?: Record<string, unknown>) {
  return logWithContext("error", msg, meta);
}
