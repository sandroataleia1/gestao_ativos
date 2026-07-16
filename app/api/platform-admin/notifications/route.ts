import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { listPlatformNotificationsPage, listPlatformNotificationsForBell, type NotificationPageFilter } from "@/lib/notifications-listing";
import { toClientNotification } from "@/lib/notifications-client-dto";
import { handleApiError } from "@/lib/api-errors";

// Sprint SST 1.4E, §14 — leitura das notificações do Portal Super Admin.
// Autorização exclusivamente por PlatformUser ativo (SUPER_ADMIN) — nenhuma
// dependência de CompanyMembership/User.companyId/active_company_id.
export async function GET(request: Request) {
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const context = { portal: "PLATFORM" as const };
    const { searchParams } = new URL(request.url);

    if (searchParams.get("view") === "bell") {
      const items = await listPlatformNotificationsForBell({ userId: user.id });
      return NextResponse.json({ items: items.map((i) => toClientNotification(i, context)) });
    }

    const filterParam = searchParams.get("filter") ?? "ALL";
    const filter = filterParam as NotificationPageFilter;
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || undefined;
    const category = searchParams.get("category");
    const types =
      category === "CLAIMS"
        ? (["PLATFORM_COMPANY_CLAIM_REQUESTED"] as const)
        : category === "DISPUTES"
          ? (["PLATFORM_COMPANY_CLAIM_DISPUTED"] as const)
          : undefined;

    const result = await listPlatformNotificationsPage({ userId: user.id, filter, types: types ? [...types] : undefined, page, pageSize });

    return NextResponse.json({ ...result, items: result.items.map((i) => toClientNotification(i, context)) });
  } catch (error) {
    return handleApiError(error);
  }
}
