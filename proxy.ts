import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Next.js 16 renomeou middleware.ts -> proxy.ts (a função exportada chama
// `proxy`, não mais `middleware`) e passou a rodar em runtime Node.js por
// padrão — ver node_modules/next/dist/docs/.../file-conventions/proxy.md.
// Isso é o que permite o `Map` em memória de lib/rate-limit.ts persistir
// corretamente entre requisições (não seria garantido em Edge runtime).
//
// Rate limiting cobre só as rotas públicas que NÃO passam pelo Better Auth
// (login, cadastro via /sign-up/email e recuperação de senha via
// /api/auth/reset-password já têm rate limiting nativo próprio, configurado
// em lib/auth.ts via `rateLimit`). Aqui ficam: /api/register (cadastro de
// empresa, rota própria), os links públicos de QR Code e assinatura
// digital, e a página de definição de senha.
const RULES: { matches: (pathname: string) => boolean; bucket: string; windowMs: number; max: number }[] = [
  { matches: (p) => p === "/api/register", bucket: "register", windowMs: 60_000, max: 5 },
  { matches: (p) => p === "/api/sst/register", bucket: "sst-register", windowMs: 60_000, max: 5 },
  {
    matches: (p) => p.startsWith("/api/qr/") || p.startsWith("/q/"),
    bucket: "qr-public",
    windowMs: 60_000,
    max: 30,
  },
  {
    matches: (p) => p.startsWith("/api/signature-requests/") || p.startsWith("/assinar/"),
    bucket: "signature-public",
    windowMs: 60_000,
    max: 30,
  },
  {
    matches: (p) => p.startsWith("/redefinir-senha/"),
    bucket: "reset-password-public",
    windowMs: 60_000,
    max: 30,
  },
  // Sprint Comercial SST 1.4, §18 — a consulta de CNPJ já exige sessão
  // autenticada (OWNER da consultoria) e nunca faz busca parcial, mas
  // recebe limite de taxa por IP como camada extra contra enumeração
  // automatizada em massa (mesmo por uma sessão comprometida). Pré-cadastro/
  // solicitação de acesso ganham o mesmo limite por serem as mutações que
  // dependem da mesma checagem de CNPJ.
  {
    matches: (p) =>
      p === "/api/sst/companies/check-cnpj" ||
      p === "/api/sst/companies/pre-register" ||
      p === "/api/sst/companies/request-access",
    bucket: "sst-cnpj",
    windowMs: 60_000,
    max: 20,
  },
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Observabilidade (docs/observability.md): request id sempre novo;
  // correlation id reaproveita o do client se ele mandar um (útil pra
  // encadear várias requisições da mesma operação lógica), senão cai no
  // próprio request id. Os dois são propagados como header de request
  // (Route Handler lê via next/headers()) e de resposta (X-Request-Id/
  // X-Correlation-Id, pro client correlacionar um erro reportado com o log
  // do servidor).
  const requestId = randomUUID();
  const correlationId = request.headers.get("x-correlation-id") || requestId;

  const rule = RULES.find((r) => r.matches(pathname));
  if (rule) {
    const ip = getClientIp(request.headers);
    const { allowed, retryAfterSeconds } = checkRateLimit(rule.bucket, ip, rule);
    if (!allowed) {
      return NextResponse.json(
        { error: "Muitas requisições. Tente novamente em instantes." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
            "X-Request-Id": requestId,
            "X-Correlation-Id": correlationId,
          },
        },
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-correlation-id", correlationId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Correlation-Id", correlationId);
  return response;
}

export const config = {
  matcher: [
    // Todas as rotas exceto assets estáticos/otimização de imagem/favicon —
    // mesmo padrão de negative-lookahead da doc de CSP do próprio Next
    // (node_modules/next/dist/docs/.../content-security-policy.md).
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
