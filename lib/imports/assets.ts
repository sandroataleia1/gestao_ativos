import { z } from "zod";

import type { Prisma } from "@/app/generated/prisma/client";
import { assetInputSchema, TRACKING_MODE_VALUES } from "@/lib/validations/asset";
import { CERTIFICATION_STATUS_VALUES } from "@/lib/validations/certification";
import { upsertAssetCertification } from "@/lib/certifications";
import type { WorkbookRow } from "@/lib/excel";
import type { ImportRowResult } from "@/lib/imports/types";
import {
  findOrCreateAssetCategory,
  findOrCreateManufacturer,
  findOrCreateSupplier,
  resolveByNameOrDefault,
} from "@/lib/imports/lookups";

const assetRowSchema = z.object({
  categoria: z.string().trim().min(1, "Informe a categoria."),
  nome: z.string().trim().min(1, "Informe o nome."),
  codigo_sku: z.string().trim().min(1, "Informe o código/SKU."),
  modo_controle: z.string().trim().optional(),
  unidade_medida: z.string().trim().optional(),
  fabricante: z.string().trim().optional(),
  fornecedor: z.string().trim().optional(),
  status: z.string().trim().optional(),
  condicao: z.string().trim().optional(),
  estoque_minimo: z.string().trim().optional(),
  possui_ca: z.string().trim().optional(),
  numero_ca: z.string().trim().optional(),
  validade_ca: z.string().trim().optional(),
  situacao_ca: z.string().trim().optional(),
});

function parseTrackingMode(raw: string | undefined): { value: "INDIVIDUAL" | "CONSUMABLE"; note?: string } {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (["individual"].includes(normalized)) return { value: "INDIVIDUAL" };
  if (["consumivel", "consumível", "consumable"].includes(normalized)) return { value: "CONSUMABLE" };
  if (!normalized) return { value: "INDIVIDUAL", note: 'Modo de controle não informado — assumido "Individual".' };
  return {
    value: "INDIVIDUAL",
    note: `Modo de controle "${raw}" não reconhecido — assumido "Individual".`,
  };
}

function parseBoolean(raw: string | undefined): boolean {
  const normalized = (raw ?? "").trim().toLowerCase();
  return ["sim", "yes", "true", "1", "x"].includes(normalized);
}

/**
 * Processa uma linha da planilha de ativos — mesma lógica de
 * lib/imports/employees.ts (dryRun nunca grava, tx deve ser transação
 * própria da linha quando dryRun=false).
 */
export async function processAssetRow(
  tx: Prisma.TransactionClient,
  companyId: string,
  row: WorkbookRow,
  dryRun = false,
): Promise<ImportRowResult> {
  const errors: string[] = [];
  const notes: string[] = [];
  const preview: Record<string, string> = { ...row.cells };

  const parsedRow = assetRowSchema.safeParse(row.cells);
  if (!parsedRow.success) {
    for (const issue of parsedRow.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }
  const raw = parsedRow.data;

  const category = await findOrCreateAssetCategory(tx, companyId, raw.categoria, dryRun);
  if (!category && !dryRun) {
    errors.push(`categoria: Não foi possível resolver a categoria "${raw.categoria}".`);
  }
  if (category?.created) notes.push(`Categoria "${raw.categoria}" criada.`);
  else if (!category && dryRun) notes.push(`Categoria "${raw.categoria}" será criada.`);

  let manufacturerId: string | undefined;
  if (raw.fabricante) {
    const manufacturer = await findOrCreateManufacturer(tx, companyId, raw.fabricante, dryRun);
    manufacturerId = manufacturer?.id;
    if (manufacturer?.created) notes.push(`Fabricante "${raw.fabricante}" criado.`);
    else if (!manufacturer && dryRun) notes.push(`Fabricante "${raw.fabricante}" será criado.`);
  }

  let supplierId: string | undefined;
  if (raw.fornecedor) {
    const supplier = await findOrCreateSupplier(tx, companyId, raw.fornecedor, dryRun);
    supplierId = supplier?.id;
    if (supplier?.created) notes.push(`Fornecedor "${raw.fornecedor}" criado.`);
    else if (!supplier && dryRun) notes.push(`Fornecedor "${raw.fornecedor}" será criado.`);
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

  const trackingMode = parseTrackingMode(raw.modo_controle);
  if (trackingMode.note) notes.push(trackingMode.note);
  if (!TRACKING_MODE_VALUES.includes(trackingMode.value)) {
    errors.push("modo_controle: valor inválido.");
  }

  const hasCa = parseBoolean(raw.possui_ca);
  let certification: z.infer<typeof assetInputSchema>["certification"];
  if (hasCa) {
    if (!raw.numero_ca) {
      errors.push("numero_ca: Informe o número do CA (possui_ca está marcado).");
    } else {
      const situacao = (raw.situacao_ca ?? "").trim().toUpperCase();
      const caStatus = CERTIFICATION_STATUS_VALUES.includes(situacao as never)
        ? (situacao as (typeof CERTIFICATION_STATUS_VALUES)[number])
        : "VALID";
      certification = {
        certificationType: "CA",
        certificationNumber: raw.numero_ca,
        expirationDate: raw.validade_ca ? new Date(raw.validade_ca) : undefined,
        status: caStatus,
      };
    }
  }

  if (errors.length > 0 || !category || !status || !condition) {
    return {
      rowNumber: row.rowNumber,
      status: "error",
      errors: errors.length ? errors : ["Não foi possível resolver todas as referências desta linha."],
      notes,
      preview,
    };
  }

  const businessInput = assetInputSchema.safeParse({
    name: raw.nome,
    assetCode: raw.codigo_sku,
    categoryId: category.id,
    manufacturerId,
    supplierId,
    statusId: status.id,
    conditionId: condition.id,
    trackingMode: trackingMode.value,
    defaultUnit: raw.unidade_medida,
    minimumStock: raw.estoque_minimo,
    certification,
  });
  if (!businessInput.success) {
    for (const issue of businessInput.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }
  const { certification: certificationInput, ...assetData } = businessInput.data;

  const existing = await tx.asset.findFirst({
    where: { companyId, assetCode: assetData.assetCode },
    select: { id: true },
  });

  // Código/SKU duplicado na empresa -> atualiza o existente (mesma
  // justificativa do documento de colaborador — ver docs/imports.md).
  if (existing) {
    notes.push("Ativo já existe (mesmo código/SKU) — será atualizado.");
    if (!dryRun) {
      await tx.asset.update({ where: { id: existing.id }, data: assetData });
      if (certificationInput) {
        await upsertAssetCertification(tx, companyId, existing.id, certificationInput);
      }
      return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "updated", preview };
    }
    return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
  }

  if (!dryRun) {
    const created = await tx.asset.create({ data: { ...assetData, companyId } });
    if (certificationInput) {
      await upsertAssetCertification(tx, companyId, created.id, certificationInput);
    }
    return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "created", preview };
  }

  return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
}
