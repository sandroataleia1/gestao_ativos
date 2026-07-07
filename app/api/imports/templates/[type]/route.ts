import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { buildTemplateWorkbook } from "@/lib/excel";
import {
  ASSET_COLUMNS,
  ASSET_EXAMPLE_ROW,
  EMPLOYEE_COLUMNS,
  EMPLOYEE_EXAMPLE_ROW,
  STOCK_CONSUMABLE_COLUMNS,
  STOCK_CONSUMABLE_EXAMPLE_ROW,
  STOCK_INDIVIDUAL_COLUMNS,
  STOCK_INDIVIDUAL_EXAMPLE_ROW,
} from "@/lib/imports/columns";

type RouteParams = { params: Promise<{ type: string }> };

const TEMPLATES: Record<string, { fileName: string; headers: readonly string[]; example: string[] }> = {
  employees: { fileName: "modelo-colaboradores.xlsx", headers: EMPLOYEE_COLUMNS, example: [...EMPLOYEE_EXAMPLE_ROW] },
  assets: { fileName: "modelo-ativos.xlsx", headers: ASSET_COLUMNS, example: [...ASSET_EXAMPLE_ROW] },
  "stock-consumable": {
    fileName: "modelo-estoque-consumivel.xlsx",
    headers: STOCK_CONSUMABLE_COLUMNS,
    example: [...STOCK_CONSUMABLE_EXAMPLE_ROW],
  },
  "stock-individual": {
    fileName: "modelo-estoque-individual.xlsx",
    headers: STOCK_INDIVIDUAL_COLUMNS,
    example: [...STOCK_INDIVIDUAL_EXAMPLE_ROW],
  },
};

// Só leitura (nenhum dado é gravado) — gated por IMPORT_VIEW, não
// IMPORT_MANAGE, pra deixar quem só visualiza baixar o modelo e entender o
// formato esperado sem precisar de permissão de escrita.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    await requirePermission(PERMISSIONS.IMPORT_VIEW);
    const { type } = await params;

    const template = TEMPLATES[type];
    if (!template) throw new NotFoundError("Modelo de importação não encontrado.");

    const buffer = await buildTemplateWorkbook(template.headers as string[], template.example);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${template.fileName}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
