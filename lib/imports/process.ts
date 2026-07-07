import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import { readWorkbookRows, type WorkbookRow } from "@/lib/excel";
import { processEmployeeRow } from "@/lib/imports/employees";
import { processAssetRow } from "@/lib/imports/assets";
import { processStockRow } from "@/lib/imports/stock";
import { summarize, type ImportEntityType, type ImportResult, type ImportRowResult } from "@/lib/imports/types";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const VALID_TYPES: ImportEntityType[] = ["employees", "assets", "stock"];
const ACCEPTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream", // alguns navegadores/SO não reconhecem o MIME de .xlsx
]);

/**
 * Extrai e valida `type` + `file` de um FormData (preview/confirm usam o
 * mesmo formato) — extensão, MIME e tamanho são checados aqui, antes de
 * qualquer coisa chegar ao exceljs. `companyId` nunca vem daqui: sempre de
 * `requirePermission` na própria rota.
 */
export async function parseImportFormData(
  request: Request,
): Promise<{ type: ImportEntityType; buffer: Buffer }> {
  const form = await request.formData();
  const type = form.get("type");
  const file = form.get("file");

  if (typeof type !== "string" || !VALID_TYPES.includes(type as ImportEntityType)) {
    throw new ValidationError("Tipo de importação inválido.");
  }
  if (!(file instanceof File)) {
    throw new ValidationError("Envie um arquivo.");
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new ValidationError("Só são aceitos arquivos .xlsx.");
  }
  if (file.type && !ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new ValidationError("Formato de arquivo não reconhecido — envie um .xlsx válido.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError("Arquivo maior que o limite de 5MB.");
  }

  const arrayBuffer = await file.arrayBuffer();
  return { type: type as ImportEntityType, buffer: Buffer.from(arrayBuffer) };
}

function runRow(
  tx: Prisma.TransactionClient,
  type: ImportEntityType,
  companyId: string,
  userId: string,
  row: WorkbookRow,
  dryRun: boolean,
): Promise<ImportRowResult> {
  switch (type) {
    case "employees":
      return processEmployeeRow(tx, companyId, row, dryRun);
    case "assets":
      return processAssetRow(tx, companyId, row, dryRun);
    case "stock":
      return processStockRow(tx, companyId, userId, row, dryRun);
  }
}

/**
 * Orquestra a importação inteira (preview OU confirmação — a mesma função
 * pros dois, só variando `dryRun`; ver app/api/imports/preview e
 * app/api/imports/confirm). Nunca grava linha nenhuma quando `dryRun` é
 * true. Quando `dryRun` é false, cada linha grava dentro da sua própria
 * transação — uma falha isolada (ex.: corrida numa constraint unique) nunca
 * desfaz as linhas já gravadas com sucesso; o resultado reporta sucesso ou
 * erro por linha, nunca all-or-nothing pro arquivo inteiro. Linhas inválidas
 * nunca são gravadas independentemente do modo — não existe distinção de
 * "importar tudo" vs. "importar só as válidas" no backend, só no rótulo do
 * botão na UI.
 */
export async function processImportFile(params: {
  type: ImportEntityType;
  buffer: Buffer;
  companyId: string;
  userId: string;
  dryRun: boolean;
}): Promise<ImportResult> {
  const { type, buffer, companyId, userId, dryRun } = params;
  const workbookRows = await readWorkbookRows(buffer);

  const results: ImportRowResult[] = [];
  for (const row of workbookRows) {
    try {
      if (dryRun) {
        results.push(await runRow(prisma, type, companyId, userId, row, true));
      } else {
        results.push(
          await prisma.$transaction((tx) => runRow(tx, type, companyId, userId, row, false)),
        );
      }
    } catch (error) {
      results.push({
        rowNumber: row.rowNumber,
        status: "error",
        errors: [error instanceof Error ? error.message : "Erro inesperado ao processar esta linha."],
        notes: [],
        preview: row.cells,
      });
    }
  }

  return { summary: summarize(results), rows: results };
}
