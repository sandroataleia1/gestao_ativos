// Rate limiting em memória para rotas públicas que não passam pelo Better
// Auth (que já tem rate limiting nativo próprio — ver `rateLimit` em
// lib/auth.ts). Usado só por proxy.ts para /api/register, /q/[token] e
// /assinar/[token].
//
// Por quê em memória e não Redis/Upstash: a implantação atual roda um único
// processo PM2 em modo "fork" (não "cluster"), então não há múltiplas
// instâncias Node para sincronizar — um Map local já garante o mesmo limite
// para todo mundo. É exatamente a mesma escolha que o próprio Better Auth
// faz por padrão (`rateLimit.storage: "memory"`, ver
// node_modules/better-auth/dist/api/rate-limiter/index.mjs), então não
// estamos inventando uma abordagem nova, só espelhando a que já está em uso
// nesta mesma aplicação. Se um dia a implantação virar múltiplas instâncias
// (PM2 cluster ou vários servidores), isso precisa migrar para um storage
// compartilhado (Redis) — o formato de `checkRateLimit` abaixo não muda,
// só a implementação interna do Map.
//
// Limitação conhecida: o contador zera a cada restart do processo (deploy,
// crash, `pm2 restart`). Aceitável para o objetivo desta rotina, que é
// conter abuso automatizado contínuo, não bloquear uma rajada legítima
// pontual.

type RateLimitRule = {
  windowMs: number;
  max: number;
};

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const store = new Map<string, RateLimitEntry>();

const MAX_STORE_ENTRIES = 50_000;

function pruneExpired(now: number, windowMs: number) {
  if (store.size <= MAX_STORE_ENTRIES) return;
  for (const [key, entry] of store) {
    if (now - entry.windowStart > windowMs) store.delete(key);
  }
}

/**
 * Janela fixa por chave (bucket+ip). Decide-e-incrementa num passo só —
 * como o Map é acessado de forma síncrona dentro do event loop único do
 * Node, não há corrida entre "ler contagem" e "gravar contagem" (mesma
 * garantia que o comentário de `decideConsume` do Better Auth documenta
 * para o próprio storage em memória dele).
 */
export function checkRateLimit(
  bucket: string,
  ip: string,
  rule: RateLimitRule,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${bucket}:${ip}`;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > rule.windowMs) {
    pruneExpired(now, rule.windowMs);
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= rule.max) {
    const retryAfterSeconds = Math.ceil((entry.windowStart + rule.windowMs - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Extrai o IP do cliente a partir de `X-Forwarded-For` (a implantação em
 * produção roda atrás de um nginx no mesmo host — ver docs de deploy). Só
 * usa o primeiro endereço da cadeia (o IP original do cliente, já que o
 * nginx sempre acrescenta o dele à direita). Não faz a validação completa
 * de proxy confiável/CIDR que o Better Auth faz internamente
 * (`@better-auth/core/utils/ip`) porque aqui o rate limit é uma camada de
 * contenção adicional para rotas públicas, não o único controle de acesso —
 * na pior hipótese (IP forjado) o efeito é só um bucket compartilhado menos
 * preciso, nunca um bypass de autenticação/autorização.
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
