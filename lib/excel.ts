import { Workbook } from "exceljs";

// Wrapper fino sobre exceljs — usado pela importação em lote (ver
// lib/imports/*, app/api/imports/*). Escolhido no lugar de `xlsx`
// (SheetJS): a versão publicada no npm do `xlsx` tem vulnerabilidades de
// alta severidade sem correção (prototype pollution + ReDoS), sem previsão
// de novo release ali — ver docs/imports.md. O exceljs nunca *executa*
// fórmula: ao ler uma célula com fórmula, só devolve o último valor
// calculado que o Excel já deixou salvo (`cell.value.result`), nunca
// recalcula nada.

/**
 * Remove acentos e normaliza para minúsculo — usado tanto pra gerar as
 * chaves de linha quanto pra casar o cabeçalho real da planilha (que o
 * usuário pode digitar com acentuação/capitalização levemente diferente da
 * do modelo baixado) com as colunas esperadas por cada tipo de importação.
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // Célula com fórmula: usa só o resultado já calculado, nunca reavalia.
    if ("result" in (value as Record<string, unknown>)) {
      return cellToText((value as { result: unknown }).result);
    }
    // Rich text: concatena os trechos.
    if ("richText" in (value as Record<string, unknown>)) {
      return (value as { richText: { text: string }[] }).richText.map((run) => run.text).join("");
    }
    if ("text" in (value as Record<string, unknown>)) {
      return String((value as { text: unknown }).text ?? "");
    }
    return "";
  }
  return String(value).trim();
}

export type WorkbookRow = { rowNumber: number; cells: Record<string, string> };

/**
 * Lê a primeira planilha do arquivo: linha 1 é cabeçalho (chaves
 * normalizadas via `normalizeHeader`), linhas seguintes viram `cells`.
 * Linhas totalmente vazias são ignoradas. `rowNumber` é o número real da
 * linha na planilha (útil pra apontar erro exatamente onde o usuário
 * precisa corrigir).
 */
export async function readWorkbookRows(buffer: Buffer): Promise<WorkbookRow[]> {
  const workbook = new Workbook();
  // Cast só pra contornar uma incompatibilidade de tipos do exceljs: o
  // `.d.ts` dele declara sua própria interface global `Buffer extends
  // ArrayBuffer`, que se mescla com a do @types/node e passa a exigir
  // métodos de ArrayBuffer redimensionável (lib "esnext") que o Buffer real
  // do Node não implementa — problema só de tipagem, o valor em si é um
  // Buffer normal e funciona sem ressalvas em tempo de execução.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers: (string | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const text = cellToText(cell.value);
    headers[colNumber] = text ? normalizeHeader(text) : null;
  });

  const rows: WorkbookRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const cells: Record<string, string> = {};
    let hasContent = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      const text = cellToText(cell.value);
      cells[header] = text;
      if (text) hasContent = true;
    });

    if (hasContent) rows.push({ rowNumber, cells });
  }

  return rows;
}

/**
 * Gera o modelo `.xlsx` de download — só cabeçalho (na grafia exata que a
 * importação espera) + uma linha de exemplo em itálico/cinza (meramente
 * ilustrativa, não é lida pela importação porque a linha 2 sempre é
 * tratada como dado real só quando a importação de verdade rodar — o
 * usuário deve apagar essa linha antes de preencher os dados reais).
 */
export async function buildTemplateWorkbook(headers: string[], exampleRow?: string[]): Promise<Buffer> {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Modelo");

  worksheet.addRow(headers);
  const headerRowRef = worksheet.getRow(1);
  headerRowRef.font = { bold: true };
  worksheet.columns = headers.map((header) => ({ width: Math.max(header.length + 4, 14) }));

  if (exampleRow) {
    const row = worksheet.addRow(exampleRow);
    row.font = { italic: true, color: { argb: "FF888888" } };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
