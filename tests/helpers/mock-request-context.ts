// Mock de `cookies()` (next/headers) para uso em `vi.mock("next/headers", ...)`
// nos testes de integração — permite controlar e inspecionar o cookie
// `active_company_id` (lib/company-context-request.ts) sem depender de um
// request real do Next.
//
// Módulo separado (em vez de inline em cada arquivo de teste) para reuso:
// Vitest isola o registro de módulos POR ARQUIVO de teste (default
// `test.isolate: true`), então cada arquivo que importa isto recebe seu
// próprio `cookieStore` — não há vazamento de estado entre arquivos, só
// entre `it()` do mesmo arquivo (por isso os testes que usam
// `setActiveCompanyCookie`/`set`/`delete` devem chamar `resetCookieStore()`
// no início/fim de cada caso — ver `afterEach` nos arquivos de teste).

export type MockCookieSetCall = { name: string; value: string; options?: Record<string, unknown> };

const cookieStore = new Map<string, string>();
let lastSetCall: MockCookieSetCall | null = null;
let lastDeletedName: string | null = null;

export function resetCookieStore() {
  cookieStore.clear();
  lastSetCall = null;
  lastDeletedName = null;
}

export function setActiveCompanyCookie(companyId: string | null) {
  if (companyId === null) {
    cookieStore.delete("active_company_id");
  } else {
    cookieStore.set("active_company_id", companyId);
  }
}

/** Última chamada a `cookies().set(...)` capturada — usada para verificar os
 * atributos (httpOnly/sameSite/secure/path/maxAge) que a rota gravou. */
export function getLastSetCookieCall(): MockCookieSetCall | null {
  return lastSetCall;
}

/** Nome do último cookie removido via `cookies().delete(name)`. */
export function getLastDeletedCookieName(): string | null {
  return lastDeletedName;
}

/** Compatível com o subconjunto de `ReadonlyRequestCookies`/`RequestCookies`
 * que `lib/company-context-request.ts` usa (`get`/`set`/`delete`). */
export async function mockCookies() {
  return {
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieStore.set(name, value);
      lastSetCall = { name, value, options };
    },
    delete: (name: string) => {
      cookieStore.delete(name);
      lastDeletedName = name;
    },
  };
}
