import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getAssetsReport } from "@/lib/reports";

function param(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.REPORT_VIEW);
    const { searchParams } = new URL(request.url);

    const report = await getAssetsReport(companyId, {
      categoryId: param(searchParams, "categoryId"),
      statusId: param(searchParams, "statusId"),
      conditionId: param(searchParams, "conditionId"),
      assetId: param(searchParams, "assetId"),
      dateFrom: param(searchParams, "dateFrom"),
      dateTo: param(searchParams, "dateTo"),
    });

    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error);
  }
}
