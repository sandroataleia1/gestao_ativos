import { NextResponse } from "next/server";

import { requireSstCompanyViewAccess } from "@/lib/sst-auth";
import { getSstCompanyEmployeesPage } from "@/lib/sst-employees";
import { handleApiError } from "@/lib/api-errors";
import { parsePageParams, parseSearchParam } from "@/lib/pagination";

type RouteParams = { params: Promise<{ companyId: string }> };

// Só leitura — a consultoria nunca cria/edita/inativa/exclui Employee (ver
// docs/portal-consultoria.md). Só colaboradores ACTIVE, paginado (nunca
// carrega todos de uma vez).
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());
    const { page, pageSize } = parsePageParams(searchParamsObject, { defaultPageSize: 20 });
    const search = parseSearchParam(searchParamsObject);

    const { rows, total } = await getSstCompanyEmployeesPage(companyId, {
      page,
      pageSize,
      search: search || undefined,
    });

    return NextResponse.json({ employees: rows, total });
  } catch (error) {
    return handleApiError(error);
  }
}
