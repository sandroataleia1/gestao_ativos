import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { listSstNotificationsPage, listSstNotificationsForBell, type NotificationPageFilter } from "@/lib/notifications-listing";
import { toClientNotification } from "@/lib/notifications-client-dto";
import { handleApiError } from "@/lib/api-errors";

// Sprint SST 1.4E, §14 — leitura das notificações do Portal Consultoria.
// `sstProviderId`/papel sempre vêm da sessão (`requireSstAuth`) — nunca de
// um parâmetro do cliente.
export async function GET(request: Request) {
  try {
    const { user, providerId, sstProviderUser } = await requireSstAuth();
    const context = { portal: "SST_PROVIDER" as const };
    const { searchParams } = new URL(request.url);

    if (searchParams.get("view") === "bell") {
      const items = await listSstNotificationsForBell({ userId: user.id, sstProviderId: providerId, role: sstProviderUser.role });
      return NextResponse.json({ items: items.map((i) => toClientNotification(i, context)) });
    }

    const filterParam = searchParams.get("filter") ?? "ALL";
    const filter = filterParam as NotificationPageFilter;
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || undefined;
    const category = searchParams.get("category");
    const types =
      category === "ACCESSES"
        ? (["SST_ACCESS_APPROVED", "SST_ACCESS_REJECTED", "SST_ACCESS_SUSPENDED", "SST_ACCESS_REVOKED", "SST_ACCESS_LEVEL_CHANGED"] as const)
        : category === "COMPANIES"
          ? (["SST_COMPANY_CLAIM_STARTED", "SST_AUTHORIZATION_CONFIRMED", "SST_AUTHORIZATION_BLOCKED"] as const)
          : undefined;

    const result = await listSstNotificationsPage({
      userId: user.id,
      sstProviderId: providerId,
      role: sstProviderUser.role,
      filter,
      types: types ? [...types] : undefined,
      page,
      pageSize,
    });

    return NextResponse.json({ ...result, items: result.items.map((i) => toClientNotification(i, context)) });
  } catch (error) {
    return handleApiError(error);
  }
}
