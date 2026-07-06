// Exportação CSV client-side — cada relatório já tem as linhas carregadas na
// tela (respeitando os filtros aplicados), então gerar o CSV é só serializar
// o que já está renderizado, sem round-trip ao servidor. Geração de PDF é
// trabalho futuro (não implementado); esta função é o único mecanismo de
// exportação hoje.

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }
  return lines.join("\n");
}

/** BOM (`﻿`) na frente do conteúdo garante que o Excel abra o CSV como
 * UTF-8 em vez de tentar adivinhar a codificação — sem isso, acentos em
 * português aparecem corrompidos quando aberto direto no Excel/Windows. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCsv(rows);
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
