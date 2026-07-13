// Proteção contra submissão duplicada para rotas de mutação sensíveis
// (Sprint Demo Comercial — Wizard de Nova Entrega, Parte 12).
//
// Escopo deliberadamente pequeno: cache em memória do próprio processo,
// chaveado pela `Idempotency-Key` enviada pelo client (um UUID gerado uma
// vez por tentativa de confirmação, reaproveitado só em retries da MESMA
// submissão — nunca em uma nova entrega). Se a mesma chave chegar de novo
// enquanto a primeira ainda está em andamento ou já terminou (sucesso ou
// erro de negócio), devolve o resultado já computado em vez de rodar a
// transação de novo.
//
// Isso é suficiente para o caso real que motivou o pedido (duplo clique,
// retry de rede do mesmo client) e é seguro porque hoje a aplicação roda
// como um único processo PM2 (modo "fork", não "cluster") — ver
// ecosystem/deploy. NÃO é uma solução distribuída: se o processo reiniciar
// entre o clique e o retry, ou se a aplicação passar a rodar em múltiplas
// instâncias, o cache não é compartilhado e essa proteção some, sobrando
// só as defesas de banco já existentes (índice único parcial em
// AssetCustody.assetUnitId, decremento condicional de StockBalance).
// Documentado como dívida técnica no relatório da sprint — uma chave de
// idempotência persistida (tabela dedicada ou coluna) é o próximo passo
// caso o app passe a escalar horizontalmente.

type CachedEntry =
  | { status: "pending"; promise: Promise<{ status: number; body: unknown }> }
  | { status: "done"; result: { status: number; body: unknown }; expiresAt: number };

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CachedEntry>();

function sweepExpired(now: number) {
  for (const [key, entry] of cache) {
    if (entry.status === "done" && entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

/**
 * Executa `run()` uma única vez por `key` (escopada ao processo). Chamadas
 * concorrentes ou repetidas com a mesma chave aguardam/recebem o mesmo
 * resultado, sem repetir efeitos colaterais (não roda `run()` de novo).
 * Sem `key` (header ausente — client antigo ou chamador direto da API),
 * executa normalmente sem nenhuma deduplicação: mantém compatibilidade com
 * o fluxo anterior.
 */
export async function withIdempotencyKey(
  key: string | null | undefined,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  if (!key) return run();

  const now = Date.now();
  sweepExpired(now);

  const existing = cache.get(key);
  if (existing?.status === "pending") return existing.promise;
  if (existing?.status === "done") return existing.result;

  const promise = run()
    .then((result) => {
      // `run()` (handleDeliver + handleApiError) nunca rejeita por erro de
      // negócio — um 400/403 chega aqui como um valor resolvido normal
      // ({status, body}), então também fica em cache: um retry com a mesma
      // chave repete a mesma falha (ex.: "estoque insuficiente"), em vez de
      // reavaliar contra um estado que já mudou.
      cache.set(key, { status: "done", result, expiresAt: Date.now() + TTL_MS });
      return result;
    })
    .catch((error: unknown) => {
      // Só cai aqui uma exceção genuína (bug/infra) — nunca fica presa em
      // cache, para permitir uma nova tentativa legítima do usuário.
      cache.delete(key);
      throw error;
    });

  cache.set(key, { status: "pending", promise });
  return promise;
}

export function _clearIdempotencyCacheForTests() {
  cache.clear();
}
