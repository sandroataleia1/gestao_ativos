import { NextResponse } from "next/server";

import { requireSstProviderEmployeeViewAccess, requireSstProviderEmployeeManageAccess, buildSstActor } from "@/lib/sst-auth";
import { getEmployeeForCompany, updateEmployeeForCompany } from "@/lib/employees";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { employeeInputSchema } from "@/lib/validations/employee";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

// Detalhe (documento mascarado, mesma política da listagem, ver §24) — o
// formulário de EDIÇÃO busca o registro completo diretamente no servidor
// (páginas app/sst/(portal)/companies/[companyId]/employees/[employeeId]/edit),
// não por este GET; esta rota serve consumidores externos/programáticos.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, employeeId } = await params;
    await requireSstProviderEmployeeViewAccess(companyId);

    const employee = await getEmployeeForCompany(companyId, employeeId);
    return NextResponse.json({ employee: { ...employee, document: maskEmployeeDocument(employee.document) } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, employeeId } = await params;
    const ctx = await requireSstProviderEmployeeManageAccess(companyId);

    const body = await request.json();
    const input = employeeInputSchema.parse(body);

    const employee = await updateEmployeeForCompany(companyId, employeeId, input, buildSstActor(ctx));

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}
