import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { custodyListInclude, serializeCustody } from "@/lib/custodies";

// Histórico completo (ativas + devolvidas) — usado pela aba "Histórico".
export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_VIEW);
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId") ?? undefined;
    const assetId = searchParams.get("assetId") ?? undefined;
    const status = searchParams.get("status") ?? undefined;

    const custodies = await prisma.assetCustody.findMany({
      where: {
        companyId,
        ...(employeeId ? { employeeId } : {}),
        ...(assetId ? { assetId } : {}),
        ...(status === "ACTIVE" || status === "RETURNED" ? { status } : {}),
      },
      include: custodyListInclude,
      orderBy: { deliveredAt: "desc" },
      take: 500,
    });

    return NextResponse.json({ custodies: custodies.map(serializeCustody) });
  } catch (error) {
    return handleApiError(error);
  }
}
