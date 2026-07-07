import { z } from "zod";

import type { Prisma } from "@/app/generated/prisma/client";
import { employeeInputSchema } from "@/lib/validations/employee";
import type { WorkbookRow } from "@/lib/excel";
import type { ImportRowResult } from "@/lib/imports/types";
import { findOrCreateDepartment, findOrCreatePosition } from "@/lib/imports/lookups";

// Linha crua da planilha (texto livre) — bem mais permissiva que
// employeeInputSchema (que já espera valores prontos, tipo departmentId em
// vez de "setor"). Esta é só a primeira peneira de forma; a linha
// resolvida (com setor/cargo já virando id) ainda passa por
// employeeInputSchema antes de gravar, reaproveitando 100% da regra de
// negócio que o cadastro manual já usa.
const employeeRowSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome."),
  documento: z.string().trim().min(3, "Informe um documento válido."),
  email: z.string().trim().optional(),
  telefone: z.string().trim().optional(),
  matricula: z.string().trim().optional(),
  setor: z.string().trim().optional(),
  cargo: z.string().trim().optional(),
  status: z.string().trim().optional(),
});

function parseStatus(raw: string | undefined): { value: "ACTIVE" | "INACTIVE"; note?: string } {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized || ["ativo", "active"].includes(normalized)) return { value: "ACTIVE" };
  if (["inativo", "inactive"].includes(normalized)) return { value: "INACTIVE" };
  return { value: "ACTIVE", note: `Status "${raw}" não reconhecido — assumido "Ativo".` };
}

/**
 * Processa uma linha da planilha de colaboradores. `dryRun=true` (preview):
 * nunca grava nada, só resolve o que já existe e sinaliza o que seria
 * criado/atualizado. `dryRun=false` (confirmar): `tx` deve ser uma
 * transação própria dessa linha (ver app/api/imports/confirm/route.ts) —
 * uma falha aqui nunca desfaz linhas anteriores já gravadas.
 */
export async function processEmployeeRow(
  tx: Prisma.TransactionClient,
  companyId: string,
  row: WorkbookRow,
  dryRun = false,
): Promise<ImportRowResult> {
  const errors: string[] = [];
  const notes: string[] = [];
  const preview: Record<string, string> = { ...row.cells };

  const parsedRow = employeeRowSchema.safeParse(row.cells);
  if (!parsedRow.success) {
    for (const issue of parsedRow.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }
  const raw = parsedRow.data;

  let departmentId: string | undefined;
  if (raw.setor) {
    const department = await findOrCreateDepartment(tx, companyId, raw.setor, dryRun);
    if (department) {
      departmentId = department.id;
      if (department.created) notes.push(`Setor "${raw.setor}" criado.`);
    } else if (dryRun) {
      notes.push(`Setor "${raw.setor}" será criado.`);
    }
  }

  let positionId: string | undefined;
  if (raw.cargo) {
    const position = await findOrCreatePosition(tx, companyId, raw.cargo, dryRun);
    if (position) {
      positionId = position.id;
      if (position.created) notes.push(`Cargo "${raw.cargo}" criado.`);
    } else if (dryRun) {
      notes.push(`Cargo "${raw.cargo}" será criado.`);
    }
  }

  const status = parseStatus(raw.status);
  if (status.note) notes.push(status.note);

  const businessInput = employeeInputSchema.safeParse({
    name: raw.nome,
    document: raw.documento,
    email: raw.email,
    phone: raw.telefone,
    registration: raw.matricula,
    departmentId,
    positionId,
    status: status.value,
  });
  if (!businessInput.success) {
    for (const issue of businessInput.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { rowNumber: row.rowNumber, status: "error", errors, notes, preview };
  }

  const existing = await tx.employee.findFirst({
    where: { companyId, document: businessInput.data.document },
    select: { id: true },
  });

  // Documento duplicado na empresa -> atualiza o registro existente (ver
  // docs/imports.md para a justificativa: reimportar uma planilha corrigida
  // é o fluxo natural de onboarding, forçar apagar-e-recriar seria pior).
  if (existing) {
    notes.push("Colaborador já existe — será atualizado.");
    if (!dryRun) {
      await tx.employee.update({ where: { id: existing.id }, data: businessInput.data });
      return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "updated", preview };
    }
    return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
  }

  if (!dryRun) {
    await tx.employee.create({ data: { ...businessInput.data, companyId } });
    return { rowNumber: row.rowNumber, status: "valid", errors, notes, action: "created", preview };
  }

  return { rowNumber: row.rowNumber, status: "valid", errors, notes, preview };
}
