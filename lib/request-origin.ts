// Proteção CSRF leve para as rotas de escrita novas desta sprint (Sprint
// 0.6) — o projeto não tinha, até agora, uma checagem de Origin genérica
// para `/api/**` fora do Better Auth (que já valida Origin internamente
// para seus próprios endpoints via `trustedOrigins`, ver lib/auth.ts). Isso
// complementa (não substitui) a defesa principal já em vigor: cookies
// `sameSite: "lax"` tanto na sessão (lib/auth.ts) quanto no cookie de
// contexto (lib/company-context-request.ts), que já impedem o navegador de
// enviar qualquer um dos dois cookies numa requisição POST/DELETE
// cross-site.
//
// Regra: quando o header `Origin` está presente (a maioria dos POST/DELETE
// via fetch/XHR do próprio navegador sempre o envia), seu host precisa bater
// com o `Host` da requisição. Ausência de `Origin` (ex.: alguns clientes
// non-browser) não é bloqueada aqui — a defesa de `sameSite` já cobre esse
// caso para navegadores reais.
export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
