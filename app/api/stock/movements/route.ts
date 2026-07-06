import { NextResponse, type NextRequest } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getStockMovements } from "@/lib/stock";

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.STOCK_VIEW);

    const params = request.nextUrl.searchParams;
    const movements = await getStockMovements(companyId, {
      assetId: params.get("assetId")?.trim() || undefined,
      movementTypeId: params.get("movementTypeId")?.trim() || undefined,
      locationId: params.get("locationId")?.trim() || undefined,
      dateFrom: params.get("dateFrom")?.trim() || undefined,
      dateTo: params.get("dateTo")?.trim() || undefined,
    });

    return NextResponse.json({ movements });
  } catch (error) {
    return handleApiError(error);
  }
}
