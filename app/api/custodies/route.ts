import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { custodyListInclude, serializeCustody } from "@/lib/custodies";

// Custódias ativas ("Em posse do colaborador"). "Pendências de devolução" é
// o mesmo conjunto filtrado no client (expectedReturnAt no passado) — ver
// lib/custodies/badge.ts, mesmo padrão do badge de CA.
export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_VIEW);
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId") ?? undefined;
    const assetId = searchParams.get("assetId") ?? undefined;

    const custodies = await prisma.assetCustody.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        ...(employeeId ? { employeeId } : {}),
        ...(assetId ? { assetId } : {}),
      },
      include: custodyListInclude,
      orderBy: { deliveredAt: "desc" },
    });

    return NextResponse.json({ custodies: custodies.map(serializeCustody) });
  } catch (error) {
    return handleApiError(error);
  }
}
