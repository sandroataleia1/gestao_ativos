import { NextResponse, type NextRequest } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getStockRows } from "@/lib/stock";

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.STOCK_VIEW);

    const params = request.nextUrl.searchParams;
    const stock = await getStockRows(companyId, {
      assetId: params.get("assetId")?.trim() || undefined,
      categoryId: params.get("categoryId")?.trim() || undefined,
      locationId: params.get("locationId")?.trim() || undefined,
    });

    return NextResponse.json({ stock });
  } catch (error) {
    return handleApiError(error);
  }
}
