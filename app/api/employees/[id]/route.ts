import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getEmployeeForCompany, updateEmployeeForCompany, deactivateEmployeeForCompany } from "@/lib/employees";
import { employeeInputSchema } from "@/lib/validations/employee";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.EMPLOYEE_VIEW);
    const { id } = await params;

    const employee = await getEmployeeForCompany(companyId, id);

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4F — edição extraída para lib/employees.ts:
// updateEmployeeForCompany (compartilhada com o Portal Consultoria SST),
// que agora também audita a alteração (`employee.update`, antes não
// registrada) com os NOMES dos campos alterados, nunca o valor.
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
    const { id } = await params;

    const body = await request.json();
    const input = employeeInputSchema.parse(body);

    const employee = await updateEmployeeForCompany(companyId, id, input, { id: user.id, name: user.name });

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}

// Soft delete: marca o colaborador como INACTIVE. Nunca remove a linha —
// preserva o histórico caso movimentações/custódias venham a referenciá-lo.
// Extraído para lib/employees.ts:deactivateEmployeeForCompany (Sprint SST
// 1.4F) — mesmo comportamento de antes, agora compartilhado com o Portal
// Consultoria SST.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
    const { id } = await params;

    const employee = await deactivateEmployeeForCompany(companyId, id, { id: user.id, name: user.name });

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}
