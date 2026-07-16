import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { markNotificationRead } from "@/lib/notifications-receipts";
import { platformNotificationScope } from "@/lib/notifications-scope";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const { id } = await params;

    await markNotificationRead(user.id, id, platformNotificationScope());

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
