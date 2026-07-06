import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ id: string }> };

// Fotos tiradas na entrega e/ou devolução (até 5 cada, ver
// lib/validations/custody.ts) — carregadas sob demanda ao abrir "Documentos
// da custódia", nunca junto da listagem de custódias (evita inflar a
// resposta da lista com data URLs base64).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_VIEW);
    const { id } = await params;

    const custody = await prisma.assetCustody.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!custody) throw new NotFoundError("Custódia não encontrada.");

    const photos = await prisma.custodyPhoto.findMany({
      where: { companyId, custodyId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ photos });
  } catch (error) {
    return handleApiError(error);
  }
}
