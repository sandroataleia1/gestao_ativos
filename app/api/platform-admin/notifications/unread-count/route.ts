import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { countPlatformUnreadNotifications } from "@/lib/notifications-listing";
import { handleApiError } from "@/lib/api-errors";

export async function GET() {
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const count = await countPlatformUnreadNotifications({ userId: user.id });
    return NextResponse.json({ count });
  } catch (error) {
    return handleApiError(error);
  }
}
