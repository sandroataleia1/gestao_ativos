import { NextResponse } from "next/server";

import { requireCompany, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { markNotificationRead } from "@/lib/notifications-receipts";
import { companyNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4E, §15/§16 — marca como lida (individual, idempotente).
// `notificationId` sozinho nunca concede nada: `markNotificationRead`
// revalida visibilidade no escopo atual (Company ativa + permissão) antes
// de qualquer escrita — uma notificação de outra empresa retorna 404.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { user, companyId } = await requireCompany();
    const hasManagePermission = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { id } = await params;

    await markNotificationRead(user.id, id, companyNotificationScope(companyId, hasManagePermission));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
