import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { listEligibleEmployeesForTrainingClass } from "@/lib/training-participants";
import { parsePageParams, parseSearchParam } from "@/lib/pagination";

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4G, §24 — seletor de colaboradores paginado/com busca
// server-side (nunca carrega todos os Employees da empresa de uma vez).
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());
    const { page, pageSize } = parsePageParams(searchParamsObject, { defaultPageSize: 20 });
    const search = parseSearchParam(searchParamsObject);

    const { rows, total } = await listEligibleEmployeesForTrainingClass(companyId, id, {
      page,
      pageSize,
      search: search || undefined,
    });

    return NextResponse.json({ employees: rows, total });
  } catch (error) {
    return handleApiError(error);
  }
}
