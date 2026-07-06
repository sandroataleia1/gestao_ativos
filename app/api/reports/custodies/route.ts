import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getCustodiesReport } from "@/lib/reports";

function param(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.REPORT_VIEW);
    const { searchParams } = new URL(request.url);
    const status = param(searchParams, "status");

    const report = await getCustodiesReport(companyId, {
      employeeId: param(searchParams, "employeeId"),
      assetId: param(searchParams, "assetId"),
      locationId: param(searchParams, "locationId"),
      dateFrom: param(searchParams, "dateFrom"),
      dateTo: param(searchParams, "dateTo"),
      status: status === "ACTIVE" || status === "RETURNED" ? status : undefined,
    });

    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error);
  }
}
