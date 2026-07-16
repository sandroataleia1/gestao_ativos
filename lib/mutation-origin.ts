import { ForbiddenError } from "@/lib/auth-server";
import { DEV_LAN_ORIGINS } from "@/lib/dev-lan-origins";

// Sprint SST 1.4D.2, §3-4 — proteção CSRF explícita para rotas de escrita
// customizadas (`app/api/platform-admin/**` nesta sprint). Este projeto
// NÃO tem um `middleware.ts`/`proxy.ts` que valide Origin/Host (ver
// proxy.ts — só rate limit e request-id), e o `originCheckMiddleware`
// nativo do Better Auth (node_modules/better-auth/dist/api/middlewares/
// origin-check.mjs) só roda para requisições que passam pelo PRÓPRIO
// handler do Better Auth (`auth.handler`, montado em `/api/auth/**`) —
// rotas customizadas que só chamam `auth.api.getSession()` para resolver a
// sessão (como todas as de `app/api/platform-admin/**`) NUNCA passam por
// esse middleware. Ou seja: antes desta sprint, a ÚNICA coisa impedindo uma
// requisição cross-site de executar com a sessão de uma vítima era o
// atributo `sameSite: "lax"` do cookie (lib/auth.ts) — proteção real, mas
// um único ponto de falha sem nenhuma corroboração do lado do servidor.
// Este helper adiciona essa checagem como defesa em profundidade.
//
// Nunca cria um token CSRF próprio (isso duplicaria/enfraqueceria o que o
// Better Auth já faz nos próprios endpoints) — só valida Origin/Host contra
// uma allowlist derivada da MESMA fonte de verdade (`BETTER_AUTH_URL`) já
// usada pelo Better Auth, mais a origem de LAN de desenvolvimento
// (`DEV_LAN_ORIGINS`, reaproveitada de lib/auth.ts).

function resolveTrustedOrigins(): string[] {
  const origins = new Set<string>(DEV_LAN_ORIGINS);
  if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
  return [...origins];
}

function resolveTrustedHosts(): string[] {
  return resolveTrustedOrigins()
    .map((origin) => {
      try {
        return new URL(origin).host;
      } catch {
        return null;
      }
    })
    .filter((host): host is string => Boolean(host));
}

/**
 * Lança `ForbiddenError` (403, via `handleApiError`) se a requisição não
 * for de uma origem confiável. Chamar SEMPRE antes de qualquer leitura de
 * sessão/banco na rota — rejeita requisições não confiáveis o mais cedo
 * possível, sem gastar trabalho resolvendo identidade para uma requisição
 * que já será recusada.
 *
 * Regras (nesta ordem):
 * 1. `Sec-Fetch-Site: cross-site` — sinal de Fetch Metadata enviado pelo
 *    navegador, não falsificável por JavaScript da página. Presente na
 *    grande maioria dos navegadores modernos; rejeita incondicionalmente
 *    quando presente e "cross-site", mesmo que `Origin` current bata com a
 *    allowlist por coincidência.
 * 2. `Origin` — precisa estar presente E na allowlist. Uma chamada real de
 *    navegador para estas rotas (fetch same-origin com POST) SEMPRE envia
 *    `Origin` (comportamento padrão de todo navegador moderno desde ~2016,
 *    inclusive em requisições same-origin) — política é FAIL-CLOSED:
 *    ausência de `Origin` é tratada como não confiável, nunca like um "ok
 *    silencioso". Não existe hoje nenhuma chamada legítima servidor-a-
 *    servidor para estas rotas (elas chamam os serviços de domínio
 *    diretamente via import, nunca via HTTP interno) — se isso mudar no
 *    futuro, precisa de um caminho explícito e nomeado (mesmo padrão do
 *    header interno `x-internal-signup-secret` em lib/auth.ts), nunca
 *    "permitir tudo sem Origin".
 * 3. `Host` — quando presente, precisa bater com o host de uma origem
 *    confiável. Nunca lê `X-Forwarded-Host` (o nginx deste projeto nunca o
 *    define — `nginx/conf.d/patrium.conf` só define `Host: $host`,
 *    `X-Real-IP`, `X-Forwarded-For` e `X-Forwarded-Proto` — confiar nesse
 *    header seria aceitar um valor forjável por qualquer cliente direto).
 *
 * Comparação sempre por IGUALDADE EXATA contra a allowlist (nunca
 * `startsWith`/`endsWith`) — evita o erro clássico de um domínio parecido
 * (`patrium-esis.com.br`) ou um subdomínio não autorizado
 * (`evil.patrium.esis.com.br`, `patrium.esis.com.br.evil.com`) passar por
 * um checagem de prefixo/sufixo mal feita.
 */
export function requireTrustedMutationOrigin(request: Request): void {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    throw new ForbiddenError("Origem da requisição não é confiável.");
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    throw new ForbiddenError("Origem da requisição não é confiável.");
  }
  const trustedOrigins = resolveTrustedOrigins();
  if (!trustedOrigins.includes(originHeader)) {
    throw new ForbiddenError("Origem da requisição não é confiável.");
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader) {
    const trustedHosts = resolveTrustedHosts();
    if (!trustedHosts.includes(hostHeader)) {
      throw new ForbiddenError("Origem da requisição não é confiável.");
    }
  }
}
