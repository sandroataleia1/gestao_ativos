import { describe, expect, it, vi } from "vitest";

import { _clearIdempotencyCacheForTests, withIdempotencyKey } from "@/lib/idempotency";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 12 — cobertura do
// mecanismo em si (o comportamento observável via HTTP já está coberto em
// tests/tenant-isolation/delivery-wizard-deliver-route.test.ts, caso 30).

describe("withIdempotencyKey", () => {
  it("sem chave, executa run() normalmente (compatibilidade com clientes antigos)", async () => {
    _clearIdempotencyCacheForTests();
    const run = vi.fn(async () => ({ status: 201, body: { ok: true } }));
    const result = await withIdempotencyKey(null, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 201, body: { ok: true } });
  });

  it("chamadas concorrentes com a mesma chave executam run() só uma vez", async () => {
    _clearIdempotencyCacheForTests();
    let calls = 0;
    const run = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: 201, body: { id: "custody-1" } };
    };

    const [a, b] = await Promise.all([
      withIdempotencyKey("key-1", run),
      withIdempotencyKey("key-1", run),
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it("uma chamada sequencial posterior com a mesma chave devolve o resultado já em cache, sem rodar de novo", async () => {
    _clearIdempotencyCacheForTests();
    const run = vi.fn(async () => ({ status: 201, body: { id: "custody-2" } }));
    const first = await withIdempotencyKey("key-2", run);
    const second = await withIdempotencyKey("key-2", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("chaves diferentes nunca compartilham resultado", async () => {
    _clearIdempotencyCacheForTests();
    const run = vi.fn(async () => ({ status: 201, body: { id: crypto.randomUUID() } }));
    const a = await withIdempotencyKey("key-a", run);
    const b = await withIdempotencyKey("key-b", run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(a).not.toEqual(b);
  });

  it("um erro de negócio (status >= 400, valor resolvido) também fica em cache — retry com a mesma chave repete a mesma falha", async () => {
    _clearIdempotencyCacheForTests();
    const run = vi.fn(async () => ({ status: 400, body: { error: "Estoque insuficiente para esta entrega." } }));
    const first = await withIdempotencyKey("key-err", run);
    const second = await withIdempotencyKey("key-err", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("uma exceção genuína (bug/infra) NUNCA fica em cache — a próxima chamada tenta de novo", async () => {
    _clearIdempotencyCacheForTests();
    const run = vi.fn(async () => {
      throw new Error("falha inesperada de infraestrutura");
    });
    await expect(withIdempotencyKey("key-crash", run)).rejects.toThrow("falha inesperada de infraestrutura");
    await expect(withIdempotencyKey("key-crash", run)).rejects.toThrow("falha inesperada de infraestrutura");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
