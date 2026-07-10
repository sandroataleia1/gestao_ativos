import * as Sentry from "@sentry/node";

// Camada única de observabilidade de erros. Sem `SENTRY_DSN` configurado
// (ainda não há projeto Sentry criado para este app), `Sentry.init` nunca é
// chamado e as funções abaixo caem no fallback de log estruturado — ou
// seja, o código já está pronto para reportar a um serviço de verdade
// assim que alguém adicionar a variável de ambiente, sem precisar tocar em
// nenhum outro arquivo (instrumentation.ts, lib/api-errors.ts).
const SENTRY_DSN = process.env.SENTRY_DSN;
let initialized = false;

export function initMonitoring() {
  if (!SENTRY_DSN || initialized) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
  initialized = true;
}

function fallbackLog(level: "error" | "warn", payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console -- único ponto de log de
  // erro/observabilidade quando não há Sentry configurado; mantém o
  // mesmo formato estruturado que seria enviado ao Sentry.
  console[level](JSON.stringify({ ts: new Date().toISOString(), ...payload }));
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (SENTRY_DSN) {
    Sentry.captureException(error, context ? { extra: context } : undefined);
    return;
  }
  fallbackLog("error", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
  });
}

export function captureMessage(message: string, context?: Record<string, unknown>) {
  if (SENTRY_DSN) {
    Sentry.captureMessage(message, context ? { extra: context } : undefined);
    return;
  }
  fallbackLog("warn", { message, context });
}
