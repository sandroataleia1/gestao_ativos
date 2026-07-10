// Mock mínimo de `cookies()` (next/headers) para uso em `vi.mock("next/headers", ...)`
// nos testes de integração — permite controlar o cookie `active_company_id`
// (lib/company-context-request.ts) sem depender de um request real do Next.
//
// Módulo separado (em vez de inline em cada arquivo de teste) para reuso:
// Vitest isola o registro de módulos POR ARQUIVO de teste (default
// `test.isolate: true`), então cada arquivo que importa isto recebe seu
// próprio `cookieStore` — não há vazamento de estado entre arquivos, só
// entre `it()` do mesmo arquivo (por isso os testes que usam
// `setActiveCompanyCookie` devem limpar no início/fim de cada caso).

const cookieStore = new Map<string, string>();

export function resetCookieStore() {
  cookieStore.clear();
}

export function setActiveCompanyCookie(companyId: string | null) {
  if (companyId === null) {
    cookieStore.delete("active_company_id");
  } else {
    cookieStore.set("active_company_id", companyId);
  }
}

/** Compatível com o subconjunto de `ReadonlyRequestCookies` que
 * `lib/company-context-request.ts` usa (`store.get(name)?.value`). */
export async function mockCookies() {
  return {
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  };
}
