// Paginação server-side compartilhada por todas as listagens (Ativos,
// Colaboradores, Estoque, Custódias, Cadastros) — parâmetros vêm sempre da
// URL (searchParams), nunca de estado client-side isolado, para que
// busca/ordenação/página fiquem no histórico do navegador e sejam
// compartilháveis (mesmo padrão de URL-como-fonte-da-verdade já usado em
// app/(app)/reports/reports-view.tsx). `prefix` permite mais de uma tabela
// paginada na mesma página (ex.: /stock tem saldo + movimentações) sem os
// parâmetros colidirem — ver StockTable ("stock") x StockMovementsTable
// ("mov").

export const DEFAULT_PAGE_SIZE = 50;
export const MIN_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export type SearchParamsInput = Record<string, string | string[] | undefined>;

function getParam(searchParams: SearchParamsInput, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export type PageParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export function parsePageParams(
  searchParams: SearchParamsInput,
  options?: { defaultPageSize?: number; prefix?: string },
): PageParams {
  const prefix = options?.prefix ?? "";
  const rawPage = Number(getParam(searchParams, `${prefix}page`));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const defaultPageSize = options?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const rawPageSize = Number(getParam(searchParams, `${prefix}pageSize`));
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(rawPageSize)))
    : defaultPageSize;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function parseSearchParam(searchParams: SearchParamsInput, key = "q"): string {
  return (getParam(searchParams, key) ?? "").trim();
}

export type SortParams<T extends string> = { field: T; dir: "asc" | "desc" };

/** Lê `sort`/`dir` da URL, validando `sort` contra uma lista de campos
 * permitidos (nunca repassa direto pro `orderBy` do Prisma um valor vindo do
 * client sem checar). */
export function parseSortParams<T extends string>(
  searchParams: SearchParamsInput,
  allowedFields: readonly T[],
  defaultField: T,
  defaultDir: "asc" | "desc" = "asc",
  prefix = "",
): SortParams<T> {
  const rawField = getParam(searchParams, `${prefix}sort`);
  const field = (allowedFields as readonly string[]).includes(rawField ?? "")
    ? (rawField as T)
    : defaultField;
  const rawDir = getParam(searchParams, `${prefix}dir`);
  const dir = rawDir === "desc" ? "desc" : rawDir === "asc" ? "asc" : defaultDir;
  return { field, dir };
}
