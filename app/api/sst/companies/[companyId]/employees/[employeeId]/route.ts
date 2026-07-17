import { NextResponse } from "next/server";

import { requireSstProviderEmployeeViewAccess, requireSstProviderEmployeeManageAccess, buildSstActor } from "@/lib/sst-auth";
import { getEmployeeForCompany, updateEmployeeForCompany } from "@/lib/employees";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { employeeInputSchema } from "@/lib/validations/employee";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

// Detalhe — SEMPRE mascara o documento (Sprint SST 1.4F.1, §8), sem exceção
// para VIEWER/accessLevel VIEW nem para quem tem gestão: este GET nunca é o
// caminho que alimenta o formulário de edição (que busca o registro
// completo diretamente no servidor, nas páginas
// app/sst/(portal)/companies/[companyId]/employees/[employeeId]/edit, já
// atrás de requireSstProviderEmployeeManageAccessOrDeny) — esta rota serve
// só consumidores externos/programáticos de LEITURA, então nunca precisa
// devolver o valor bruto. "Separar DTO por capacidade" (§8) é resolvido
// assim: a capacidade de editar nunca passa por este endpoint.
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
