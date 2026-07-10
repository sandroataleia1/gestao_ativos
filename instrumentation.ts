import type { Instrumentation } from "next";

// Chamado uma vez quando o servidor Next.js sobe — ver
// node_modules/next/dist/docs/.../file-conventions/instrumentation.md.
export async function register() {
  const { initMonitoring } = await import("@/lib/monitoring");
  initMonitoring();
}

// Captura automaticamente qualquer erro que escape de Server
// Components/Route Handlers/Server Actions sem precisar instrumentar cada
// rota manualmente. Erros já tratados dentro de handleApiError (que sempre
// devolve uma NextResponse em vez de relançar) não passam por aqui — esses
// já são reportados no próprio catch de lib/api-errors.ts.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { captureException } = await import("@/lib/monitoring");
  captureException(error, {
    path: request.path,
    method: request.method,
    routeType: context.routeType,
  });
};
