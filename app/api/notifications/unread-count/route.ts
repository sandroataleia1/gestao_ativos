import { NextResponse } from "next/server";

import { requireCompany, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { countCompanyUnreadNotifications } from "@/lib/notifications-listing";
import { handleApiError } from "@/lib/api-errors";

export async function GET() {
  try {
    const { user, companyId } = await requireCompany();
    const hasManagePermission = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const count = await countCompanyUnreadNotifications({ userId: user.id, companyId, hasManagePermission });
    return NextResponse.json({ count });
  } catch (error) {
    return handleApiError(error);
  }
}
