import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import { getMovementType } from "@/lib/stock";
import { readWorkbookRows, type WorkbookRow } from "@/lib/excel";
import { processEmployeeRow } from "@/lib/imports/employees";
import { processAssetRow } from "@/lib/imports/assets";
import { processStockRow } from "@/lib/imports/stock";
import { createImportLookupCache, type ImportLookupCache, type NamedLookup } from "@/lib/imports/lookups";
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

// Dados de apoio (status/condição de ativo, tipo de movimentação) e o cache
// de find-or-create por nome são resolvidos UMA vez por importação inteira
// (não por linha) e reaproveitados por todas as linhas — ver
// lib/imports/lookups.ts para a justificativa do cache. Somem o N+1 de
// leitura que existia antes (2 findMany repetidos a cada linha de
// ativos/estoque).
type ImportRunContext = {
  lookupCache: ImportLookupCache;
  statuses: NamedLookup[];
  conditions: NamedLookup[];
  movementType: { id: string } | null;
  movementTypeError: string | null;
};

async function buildImportRunContext(
  type: ImportEntityType,
  companyId: string,
): Promise<ImportRunContext> {
  const lookupCache = createImportLookupCache();

  if (type !== "assets" && type !== "stock") {
    return { lookupCache, statuses: [], conditions: [], movementType: null, movementTypeError: null };
  }

  const [statuses, conditions] = await Promise.all([
    prisma.assetStatus.findMany({ where: { companyId, active: true }, select: { id: true, name: true } }),
    prisma.assetCondition.findMany({ where: { companyId, active: true }, select: { id: true, name: true } }),
  ]);

  let movementType: { id: string } | null = null;
  let movementTypeError: string | null = null;
  if (type === "stock") {
    try {
      movementType = await getMovementType(companyId, "ENTRY");
    } catch (error) {
      if (error instanceof ValidationError) movementTypeError = error.message;
      else throw error;
    }
  }

  return { lookupCache, statuses, conditions, movementType, movementTypeError };
}

function runRow(
  tx: Prisma.TransactionClient,
  type: ImportEntityType,
  companyId: string,
  userId: string,
  row: WorkbookRow,
  context: ImportRunContext,
  dryRun: boolean,
): Promise<ImportRowResult> {
  switch (type) {
    case "employees":
      return processEmployeeRow(tx, companyId, row, context.lookupCache, dryRun);
    case "assets":
      return processAssetRow(tx, companyId, row, context.lookupCache, context.statuses, context.conditions, dryRun);
    case "stock":
      return processStockRow(
        tx,
        companyId,
        userId,
        row,
        context.lookupCache,
        context.statuses,
        context.conditions,
        context.movementType,
        context.movementTypeError,
        dryRun,
      );
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
  const context = await buildImportRunContext(type, companyId);

  const results: ImportRowResult[] = [];
  for (const row of workbookRows) {
    try {
      if (dryRun) {
        results.push(await runRow(prisma, type, companyId, userId, row, context, true));
      } else {
        results.push(
          await prisma.$transaction((tx) => runRow(tx, type, companyId, userId, row, context, false)),
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
