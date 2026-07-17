import { NextResponse } from "next/server";

import { requireSstTrainingParticipantViewAccess } from "@/lib/sst-auth";
import { listEligibleEmployeesForTrainingClass } from "@/lib/training-participants";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { parsePageParams, parseSearchParam } from "@/lib/pagination";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ companyId: string; classId: string }> };

// Sprint SST 1.4G, §24/§25 — paginado, com busca server-side e documento
// sempre mascarado (nunca carrega os 2.000+ colaboradores da empresa de
// uma vez, nunca expõe o documento completo ao Portal SST).
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    await requireSstTrainingParticipantViewAccess(companyId, classId);

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());
    const { page, pageSize } = parsePageParams(searchParamsObject, { defaultPageSize: 20 });
    const search = parseSearchParam(searchParamsObject);

    const { rows, total } = await listEligibleEmployeesForTrainingClass(companyId, classId, {
      page,
      pageSize,
      search: search || undefined,
    });
    const masked = rows.map((row) => ({ ...row, document: maskEmployeeDocument(row.document) }));

    return NextResponse.json({ employees: masked, total });
  } catch (error) {
    return handleApiError(error);
  }
}
