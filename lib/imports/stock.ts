import { z } from "zod";

import type { Prisma } from "@/app/generated/prisma/client";
import { ValidationError } from "@/lib/api-errors";
import { getMovementType } from "@/lib/stock";
import type { WorkbookRow } from "@/lib/excel";
import type { ImportRowResult } from "@/lib/imports/types";
import { findOrCreateStockLocation, resolveByNameOrDefault } from "@/lib/imports/lookups";

// Aceita as colunas dos dois formatos (consumível e individual) no mesmo
// schema — qual conjunto é obrigatório depende do trackingMode real do
// Asset encontrado pelo código/SKU, nunca do que a planilha diz (mesma
// garantia de "nunca confiar no client" de app/api/custodies/deliver).
const stockRowSchema = z.object({
  codigo_sku: z.string().trim().min(1, "Informe o código/SKU."),
  local: z.string().trim().min(1, "Informe o local."),
  quantidade: z.string().trim().optional(),
  numero_serie: z.string().trim().optional(),
  patrimonio: z.string().trim().optional(),
  status: z.string().trim().optional(),
  condicao: z.string().trim().optional(),
  observação: z.string().trim().optional(),
});

/**
 * Processa uma linha da planilha de estoque inicial. Depende dos Ativos já
 * terem sido importados antes (busca por código/SKU) — ver docs/imports.md.
 * Mesmo contrato de dryRun/tx de lib/imports/employees.ts e
 * lib/imports/assets.ts.
 */
export async function processStockRow(
  tx: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  row: WorkbookRow,
  dryRun = false,
): Promise<ImportRowResult> {
  const errors: string[] = [];
  const notes: string[] = [];
  const preview: Record<string, string> = { ...row.cells };

  const parsedRow = stockRowSchema.safeParse(row.cells);
  if (!parsedRow.success) {
    for (const issue of parsedRow.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }
  const raw = parsedRow.data;

  const asset = await tx.asset.findFirst({ where: { companyId, assetCode: raw.codigo_sku } });
  if (!asset) {
    errors.push(`codigo_sku: Ativo "${raw.codigo_sku}" não encontrado — importe os ativos antes do estoque.`);
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }

  const location = await findOrCreateStockLocation(tx, companyId, raw.local, dryRun);
  if (location?.created) notes.push(`Local "${raw.local}" criado.`);
  else if (!location && dryRun) notes.push(`Local "${raw.local}" será criado.`);
  if (!location && !dryRun) {
    errors.push(`local: Não foi possível resolver o local "${raw.local}".`);
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }

  let movementType: { id: string } | null = null;
  try {
    movementType = await getMovementType(companyId, "ENTRY");
  } catch (error) {
    if (error instanceof ValidationError) errors.push(error.message);
    else throw error;
  }

  if (asset.trackingMode === "CONSUMABLE") {
    const quantity = Number(raw.quantidade);
    if (!raw.quantidade || Number.isNaN(quantity) || quantity <= 0) {
      errors.push("quantidade: Deve ser maior que zero.");
    }

    if (errors.length > 0 || !movementType) {
      return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
    }

    if (!dryRun) {
      await tx.stockBalance.upsert({
        where: { assetId_locationId: { assetId: asset.id, locationId: location!.id } },
        update: { quantity: { increment: quantity } },
        create: { companyId, assetId: asset.id, locationId: location!.id, quantity },
      });
      await tx.stockMovement.create({
        data: {
          companyId,
          assetId: asset.id,
          movementTypeId: movementType.id,
          quantity,
          destinationLocationId: location!.id,
          executedBy: userId,
          executedAt: new Date(),
          observations: raw.observação,
        },
      });
      return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "created", preview };
    }

    return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
  }

  // INDIVIDUAL — cria uma AssetUnit pra linha.
  const serialNumber = raw.numero_serie || undefined;
  const patrimonyNumber = raw.patrimonio || undefined;
  if (!serialNumber && !patrimonyNumber) {
    errors.push("numero_serie: Informe ao menos um número de série ou patrimônio.");
  }

  const [statuses, conditions] = await Promise.all([
    tx.assetStatus.findMany({ where: { companyId, active: true }, select: { id: true, name: true } }),
    tx.assetCondition.findMany({ where: { companyId, active: true }, select: { id: true, name: true } }),
  ]);
  const status = resolveByNameOrDefault(statuses, raw.status ?? "", ["Disponível"]);
  const condition = resolveByNameOrDefault(conditions, raw.condicao ?? "", ["Novo"]);
  if (status && !status.matched && raw.status) {
    notes.push(`Status "${raw.status}" não encontrado — usado o padrão da empresa.`);
  }
  if (condition && !condition.matched && raw.condicao) {
    notes.push(`Condição "${raw.condicao}" não encontrada — usada o padrão da empresa.`);
  }
  if (!status) errors.push("status: Nenhum status cadastrado para esta empresa.");
  if (!condition) errors.push("condição: Nenhuma condição cadastrada para esta empresa.");

  // Série/patrimônio duplicado -> SEMPRE erro (nunca atualiza), diferente de
  // documento/código-SKU — ver docs/imports.md para a justificativa.
  if (serialNumber || patrimonyNumber) {
    const existingUnit = await tx.assetUnit.findFirst({
      where: {
        companyId,
        OR: [
          ...(serialNumber ? [{ serialNumber }] : []),
          ...(patrimonyNumber ? [{ patrimonyNumber }] : []),
        ],
      },
      select: { id: true, serialNumber: true, patrimonyNumber: true },
    });
    if (existingUnit) {
      errors.push(
        `numero_serie/patrimonio: Já existe uma unidade com série "${existingUnit.serialNumber ?? "—"}" ou patrimônio "${existingUnit.patrimonyNumber ?? "—"}" nesta empresa.`,
      );
    }
  }

  if (errors.length > 0 || !status || !condition || !movementType) {
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }

  if (!dryRun) {
    const unit = await tx.assetUnit.create({
      data: {
        companyId,
        assetId: asset.id,
        serialNumber,
        patrimonyNumber,
        statusId: status.id,
        conditionId: condition.id,
        currentLocationId: location!.id,
      },
    });
    await tx.assetMovement.create({
      data: {
        companyId,
        assetId: asset.id,
        assetUnitId: unit.id,
        movementTypeId: movementType.id,
        quantity: 1,
        destinationLocationId: location!.id,
        executedBy: userId,
        executedAt: new Date(),
        observations: raw.observação,
      },
    });
    return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "created", preview };
  }

  return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
}
