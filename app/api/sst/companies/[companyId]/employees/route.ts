import { NextResponse } from "next/server";

import { requireSstProviderEmployeeViewAccess, requireSstProviderEmployeeManageAccess, buildSstActor } from "@/lib/sst-auth";
import { getSstCompanyEmployeesPage } from "@/lib/sst-employees";
import { createEmployeeForCompany } from "@/lib/employees";
import { employeeInputSchema } from "@/lib/validations/employee";
import { handleApiError } from "@/lib/api-errors";
import { parsePageParams, parseSearchParam } from "@/lib/pagination";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string }> };

// Sprint SST 1.4F — leitura permanece aberta a qualquer vínculo ACTIVE
// (mesmo VIEWER/accessLevel VIEW), paginado, mascarando o documento (ver
// lib/sst-employees.ts). `status` aceita ACTIVE (default)/INACTIVE/ALL —
// nunca todos os colaboradores de uma vez sem paginação.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    await requireSstProviderEmployeeViewAccess(companyId);

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());
    const { page, pageSize } = parsePageParams(searchParamsObject, { defaultPageSize: 20 });
    const search = parseSearchParam(searchParamsObject);
    const statusParam = searchParams.get("status");
    const status = statusParam === "INACTIVE" || statusParam === "ALL" ? statusParam : "ACTIVE";

    const { rows, total } = await getSstCompanyEmployeesPage(companyId, {
      page,
      pageSize,
      search: search || undefined,
      status,
    });

    return NextResponse.json({ employees: rows, total });
  } catch (error) {
    return handleApiError(error);
  }
}

// Criação — exige accessLevel OPERATION/ADMINISTRATION, papel != VIEWER,
// vínculo ACTIVE e controlStatus fora de CLAIM_PENDING/DISPUTED (ver
// requireSstProviderEmployeeManageAccess). Nenhum campo do body pode ser
// companyId/providerId/tenant — sempre resolvidos da sessão/URL já
// autorizada, nunca do payload (employeeInputSchema não tem esses campos).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId } = await params;
    const ctx = await requireSstProviderEmployeeManageAccess(companyId);

    const body = await request.json();
    const input = employeeInputSchema.parse(body);

    const employee = await createEmployeeForCompany(companyId, input, buildSstActor(ctx));

    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
