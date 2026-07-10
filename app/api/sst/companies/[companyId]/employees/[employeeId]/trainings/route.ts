import { NextResponse } from "next/server";

import { requireSstCompanyViewAccess } from "@/lib/sst-auth";
import { getEmployeeTrainingSummary } from "@/lib/sst-employees";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

// Detalhe usado pelo dialog/drawer da tela de colaboradores — separado da
// listagem paginada para não trazer o histórico completo de treinamento em
// cada linha da tabela (ver docs/portal-consultoria.md).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, employeeId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const summary = await getEmployeeTrainingSummary(companyId, employeeId);

    return NextResponse.json(summary);
  } catch (error) {
    return handleApiError(error);
  }
}
