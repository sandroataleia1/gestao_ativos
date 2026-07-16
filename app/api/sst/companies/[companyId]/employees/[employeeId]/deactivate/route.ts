import { NextResponse } from "next/server";

import { requireSstProviderEmployeeManageAccess, buildSstActor } from "@/lib/sst-auth";
import { deactivateEmployeeForCompany } from "@/lib/employees";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

// Soft delete (nunca hard delete) — mesmo comportamento de
// DELETE /api/employees/[id] no Portal Empresa, só exposto como uma ação
// própria (POST) em vez de reaproveitar o verbo DELETE, seguindo o
// contrato de rotas pedido para o Portal Consultoria (§14).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, employeeId } = await params;
    const ctx = await requireSstProviderEmployeeManageAccess(companyId);

    const employee = await deactivateEmployeeForCompany(companyId, employeeId, buildSstActor(ctx));

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}
