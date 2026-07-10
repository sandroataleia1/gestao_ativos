import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

// `prom-client` porque é o cliente Prometheus padrão pra Node — expõe
// `/api/metrics` em formato de exposição do Prometheus (texto), com as
// métricas padrão de processo (memória, CPU, event loop) de graça via
// `collectDefaultMetrics()`.
//
// Cache no `globalThis` para sobreviver ao hot-reload do Next em dev —
// sem isso, cada recarregamento de módulo registraria as métricas de novo
// no mesmo `Registry` global do prom-client e o `collectDefaultMetrics()`
// lançaria "metric already registered".
const globalForMetrics = globalThis as unknown as { metricsRegistry?: Registry };

export const metricsRegistry = globalForMetrics.metricsRegistry ?? new Registry();

if (!globalForMetrics.metricsRegistry) {
  collectDefaultMetrics({ register: metricsRegistry });
  globalForMetrics.metricsRegistry = metricsRegistry;
}

function getOrCreateCounter(name: string, help: string, labelNames: string[]) {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Counter<string>;
  return new Counter({ name, help, labelNames, registers: [metricsRegistry] });
}

function getOrCreateGauge(name: string, help: string) {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Gauge<string>;
  return new Gauge({ name, help, registers: [metricsRegistry] });
}

// Incrementado a cada `logAudit` (lib/audit.ts) — dá visibilidade de volume
// de ações críticas (login, entrega, exclusão etc.) sem precisar consultar
// o banco.
export const auditEventsCounter = getOrCreateCounter(
  "audit_events_total",
  "Total de eventos de auditoria registrados, por ação",
  ["action"],
);

// Atualizado a cada chamada de GET /api/health.
export const healthCheckStatusGauge = getOrCreateGauge(
  "health_check_status",
  "Status do último health check (1 = ok, 0 = degradado)",
);
