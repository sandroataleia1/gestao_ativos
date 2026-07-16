import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { countSstUnreadNotifications } from "@/lib/notifications-listing";
import { handleApiError } from "@/lib/api-errors";

export async function GET() {
  try {
    const { user, providerId, sstProviderUser } = await requireSstAuth();
    const count = await countSstUnreadNotifications({ userId: user.id, sstProviderId: providerId, role: sstProviderUser.role });
    return NextResponse.json({ count });
  } catch (error) {
    return handleApiError(error);
  }
}
