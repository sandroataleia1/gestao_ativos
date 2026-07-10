import { NextResponse } from "next/server";

import { metricsRegistry } from "@/lib/metrics";

// Endpoint de scraping do Prometheus (formato de exposição em texto). Sem
// `METRICS_TOKEN` configurado, fica aberto (documentado em
// docs/observability.md como recomendação operacional restringir por
// rede/nginx em produção); se configurado, exige
// `Authorization: Bearer <token>` — suportado nativamente pelo
// `scrape_configs` do Prometheus (`authorization.credentials`).
export async function GET(request: Request) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${token}`) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  const body = await metricsRegistry.metrics();
  return new NextResponse(body, {
    headers: { "Content-Type": metricsRegistry.contentType },
  });
}
