import { NextResponse } from "next/server";

import { requireCompany, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { listCompanyNotificationsPage, listCompanyNotificationsForBell, type NotificationPageFilter } from "@/lib/notifications-listing";
import { toClientNotification } from "@/lib/notifications-client-dto";
import { handleApiError } from "@/lib/api-errors";

// Sprint SST 1.4E, §14 — leitura das notificações do Portal Empresa.
// `companyId` sempre vem da sessão (`requireCompany`, que resolve a Company
// ATIVA — nunca de um parâmetro do cliente). Nunca aceita `audience`/
// `companyId` na query string. `?view=bell` retorna o recorte do popover
// (até 5, nunca inclui dispensadas); sem esse parâmetro, retorna a página
// completa paginada (usada por /notifications).
export async function GET(request: Request) {
  try {
    const { user, companyId } = await requireCompany();
    const hasManagePermission = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const context = { portal: "COMPANY" as const };

    const { searchParams } = new URL(request.url);

    if (searchParams.get("view") === "bell") {
      const items = await listCompanyNotificationsForBell({ userId: user.id, companyId, hasManagePermission });
      return NextResponse.json({ items: items.map((i) => toClientNotification(i, context)) });
    }

    const filterParam = searchParams.get("filter") ?? "ALL";
    const filter = filterParam as NotificationPageFilter;
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || undefined;
    // Categoria da aba "Acesso SST" — hoje coincide com todos os tipos de
    // audience COMPANY (só existem estes 2 até o momento), mas fica
    // explícita para o dia em que novos tipos COMPANY forem adicionados.
    const types = searchParams.get("category") === "SST_ACCESS" ? (["COMPANY_SST_ACCESS_REQUESTED", "COMPANY_SST_ACCESS_REQUEST_RESOLVED"] as const) : undefined;

    const result = await listCompanyNotificationsPage({
      userId: user.id,
      companyId,
      hasManagePermission,
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
