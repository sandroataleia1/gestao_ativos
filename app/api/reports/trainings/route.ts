import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getTrainingsReport } from "@/lib/reports";

function param(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.REPORT_VIEW);
    const { searchParams } = new URL(request.url);
    const resultStatus = param(searchParams, "resultStatus");

    const report = await getTrainingsReport(companyId, {
      companyTrainingId: param(searchParams, "companyTrainingId"),
      employeeId: param(searchParams, "employeeId"),
      dateFrom: param(searchParams, "dateFrom"),
      dateTo: param(searchParams, "dateTo"),
      resultStatus:
        resultStatus === "PENDING" || resultStatus === "APPROVED" || resultStatus === "FAILED"
          ? resultStatus
          : undefined,
    });

    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error);
  }
}
