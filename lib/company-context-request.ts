import { cookies } from "next/headers";

// ============================================================================
// Adapter de REQUEST para o contexto empresarial solicitado — separado de
// propósito de lib/company-context.ts (o resolver central nunca lê cookie
// nenhum). Este módulo é o único lugar do app que sabe o nome do cookie e
// como lê-lo; só pode ser importado de Server Component/Route Handler
// (usa `next/headers`), nunca dos hooks do Better Auth (lib/auth.ts).
//
// O valor lido aqui é SOMENTE uma preferência de UI, nunca prova de
// autorização — ver docs/adr/ADR-001, seção 4. Quem chama
// `getRequestedCompanyId()` ainda precisa passar o valor para
// `resolveCompanyContext()`, que o revalida contra uma CompanyMembership
// ACTIVE antes de conceder qualquer acesso. Nunca usar o valor deste cookie
// diretamente em `where: { companyId }` de uma query de negócio.
// ============================================================================

export const ACTIVE_COMPANY_COOKIE = "active_company_id";

/**
 * Lê a preferência de empresa ativa do cookie da requisição atual. Não
 * valida nada — só devolve o valor cru (ou `null` se ausente/vazio), pronto
 * para ser passado como `requestedCompanyId` a `resolveCompanyContext()`.
 * Nunca usar o retorno para autorizar nada diretamente.
 */
export async function getRequestedCompanyId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  return raw && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * Grava a preferência de contexto ativo. Chamado só depois que o resolver
 * central já validou que o usuário tem uma membership ACTIVE para o
 * `companyId` informado — nunca grava um valor não revalidado. `httpOnly:
 * false` é intencional aqui apenas se algum dia um seletor client-side
 * precisar lê-lo para refletir a seleção atual na UI sem round-trip; por ora
 * mantido `httpOnly` para não expor à leitura de script algo que não tem
 * uso client-side nesta sprint (nenhuma UI de seletor implementada ainda).
 */
export async function setRequestedCompanyId(companyId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 30 dias — só uma preferência de UI, sem dado sensível; se expirar,
    // o resolver cai de volta no fluxo "sem requestedCompanyId" normalmente.
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Remove a preferência (ex.: logout, ou quando a membership selecionada é
 * revogada e o cookie precisa ser limpo para não insistir num contexto morto). */
export async function clearRequestedCompanyId(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_COMPANY_COOKIE);
}
