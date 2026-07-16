import { NextResponse } from "next/server";

import { requireCompany, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { dismissNotification } from "@/lib/notifications-receipts";
import { companyNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { user, companyId } = await requireCompany();
    const hasManagePermission = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { id } = await params;

    await dismissNotification(user.id, id, companyNotificationScope(companyId, hasManagePermission));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
