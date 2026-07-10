import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { parseImportFormData, processImportFile } from "@/lib/imports/process";
import { logAudit } from "@/lib/audit";

// Grava de verdade — cada linha em sua própria transação (ver
// lib/imports/process.ts): uma falha isolada não desfaz linhas já
// importadas. Linhas inválidas nunca são gravadas, então "importar tudo" e
// "importar só as válidas" (rótulos da UI) chegam aqui do mesmo jeito — o
// resultado sempre reporta o que foi criado/atualizado/ignorado por linha.
export async function POST(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.IMPORT_MANAGE);
    const { type, buffer } = await parseImportFormData(request);

    const result = await processImportFile({ type, buffer, companyId, userId: user.id, dryRun: false });

    // Um log por importação confirmada (nunca no preview/dry-run) — só o
    // resumo agregado (contagens), nunca dado de linha/planilha.
    await logAudit(prisma, {
      companyId,
      actorUserId: user.id,
      actorName: user.name,
      action: "import.run",
      targetType: "Import",
      metadata: { type, summary: result.summary },
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
