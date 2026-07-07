import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { parseImportFormData, processImportFile } from "@/lib/imports/process";

// Nunca grava nada — só leitura contra o banco (checa duplicidade, resolve
// o que já existe) pra mostrar exatamente o que a confirmação faria.
export async function POST(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.IMPORT_MANAGE);
    const { type, buffer } = await parseImportFormData(request);

    const result = await processImportFile({ type, buffer, companyId, userId: user.id, dryRun: true });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
