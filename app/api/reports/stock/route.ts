import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getStockReport } from "@/lib/reports";

function param(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.REPORT_VIEW);
    const { searchParams } = new URL(request.url);

    const report = await getStockReport(companyId, {
      assetId: param(searchParams, "assetId"),
      categoryId: param(searchParams, "categoryId"),
      locationId: param(searchParams, "locationId"),
    });

    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error);
  }
}
