import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getEvolutionConnectionState } from "@/lib/evolution-api";

// Consulta leve de estado (sem gerar/renovar QR) — usada pelo polling
// frequente da tela pra saber quando o colaborador terminou de escanear.
// Qualquer falha ao falar com a Evolution API vira "close" (mesmo efeito de
// "ainda não conectado") em vez de erro, pra não gerar toast a cada tick do
// polling; erros reais aparecem na chamada de connect.
export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { whatsappInstanceName: true, whatsappApiKey: true },
    });

    if (!company.whatsappInstanceName || !company.whatsappApiKey) {
      return NextResponse.json({ state: "close" });
    }

    const result = await getEvolutionConnectionState(company.whatsappInstanceName, company.whatsappApiKey);
    return NextResponse.json({ state: result.ok ? result.state : "close" });
  } catch (error) {
    return handleApiError(error);
  }
}
