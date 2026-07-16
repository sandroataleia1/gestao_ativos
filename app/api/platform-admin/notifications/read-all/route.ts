import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { markAllNotificationsRead } from "@/lib/notifications-receipts";
import { platformNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

export async function POST(request: Request) {
  try {
    requireTrustedMutationOrigin(request);
    const { user } = await requirePlatformRole("SUPER_ADMIN");

    const count = await markAllNotificationsRead(user.id, platformNotificationScope());

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return handleApiError(error);
  }
}
