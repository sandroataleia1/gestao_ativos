import { NextResponse } from "next/server";

import { requireCompany, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { markAllNotificationsRead } from "@/lib/notifications-receipts";
import { companyNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

// Sprint SST 1.4E, §17 — marca como lidas só as notificações visíveis da
// Company ATIVA — nunca de outra empresa (mesmo que o mesmo usuário tenha
// outra membership).
export async function POST(request: Request) {
  try {
    requireTrustedMutationOrigin(request);
    const { user, companyId } = await requireCompany();
    const hasManagePermission = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);

    const count = await markAllNotificationsRead(user.id, companyNotificationScope(companyId, hasManagePermission));

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return handleApiError(error);
  }
}
