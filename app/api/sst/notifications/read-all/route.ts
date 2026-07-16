import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { markAllNotificationsRead } from "@/lib/notifications-receipts";
import { sstNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

// Sprint SST 1.4E, §17 — só afeta notificações do provider ATUAL (nunca de
// outra consultoria, mesmo que o usuário tenha vínculo com mais de uma).
export async function POST(request: Request) {
  try {
    requireTrustedMutationOrigin(request);
    const { user, providerId, sstProviderUser } = await requireSstAuth();

    const count = await markAllNotificationsRead(user.id, sstNotificationScope(providerId, sstProviderUser.role));

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return handleApiError(error);
  }
}
