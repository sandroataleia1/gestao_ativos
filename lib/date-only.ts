// Helpers para campos "date-only" (ex.: `expectedReturnAt`, validade de CA)
// — dias de calendário sem hora, vindos de `<input type="date">`. Nunca usar
// `new Date("YYYY-MM-DD")` diretamente nem `toLocaleDateString` para
// exibi-los: o parse é seguro (datas sem hora já são UTC pela spec do
// ECMAScript), mas `toLocaleDateString` reintroduz o fuso local na
// exibição — é aí que mora o bug de "off-by-one" (23/06 vira 22/06 em
// qualquer fuso atrás de UTC, incluindo o Brasil). A convenção deste app:
// todo campo date-only é armazenado como meia-noite UTC do dia pretendido, e
// sempre lido de volta com getters UTC, nunca locais.

/** Converte "YYYY-MM-DD" num Date ancorado em meia-noite UTC do dia
 * pretendido — explícito (não depende do parser de string do `Date`). */
export function parseDateOnlyToLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Para enviar um valor de `<input type="date">` a uma API — sempre use
 * isto em vez de `new Date(value).toISOString()`. */
export function dateOnlyToISOStringSafe(value: string): string {
  return parseDateOnlyToLocalDate(value).toISOString();
}

/** Fim do dia (23:59:59.999 UTC) do mesmo dia pretendido — usado em filtros
 * de período (`dateTo`) para incluir registros com hora do próprio dia
 * final, que um `lte` de meia-noite excluiria indevidamente. */
export function dateOnlyToEndOfDayISOStringSafe(value: string): string {
  const date = parseDateOnlyToLocalDate(value);
  date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}

/** Formata um valor date-only (Date ou ISO string) como "dd/mm/aaaa" usando
 * getters UTC — nunca `toLocaleDateString`, que reintroduziria o fuso
 * local (e, no servidor, dependeria do fuso do processo Node, não do
 * usuário). */
export function formatDateOnlyBR(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
