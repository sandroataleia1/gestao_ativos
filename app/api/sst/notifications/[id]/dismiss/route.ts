import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { dismissNotification } from "@/lib/notifications-receipts";
import { sstNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { user, providerId, sstProviderUser } = await requireSstAuth();
    const { id } = await params;

    await dismissNotification(user.id, id, sstNotificationScope(providerId, sstProviderUser.role));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
