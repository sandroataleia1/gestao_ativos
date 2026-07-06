import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getAlerts, type AlertSeverity, type AlertType } from "@/lib/alerts";

const VALID_SEVERITIES: AlertSeverity[] = ["INFO", "WARNING", "CRITICAL"];
const VALID_TYPES: AlertType[] = [
  "CA_EXPIRED",
  "CA_EXPIRING_SOON",
  "CUSTODY_OVERDUE",
  "LOW_STOCK",
];

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ALERT_VIEW);
    const { searchParams } = new URL(request.url);

    const severityParam = searchParams.get("severity");
    const typeParam = searchParams.get("type");

    const result = await getAlerts(companyId, {
      severity: VALID_SEVERITIES.includes(severityParam as AlertSeverity)
        ? (severityParam as AlertSeverity)
        : undefined,
      type: VALID_TYPES.includes(typeParam as AlertType) ? (typeParam as AlertType) : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
