import { NextResponse } from "next/server";

import {
  buildSstActor,
  requireSstCompanyOperationAccess,
  requireSstCompanyViewAccess,
} from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { handleApiError } from "@/lib/api-errors";
import { createTrainingClass, getTrainingClassesPage, TRAINING_CLASS_SORT_FIELDS } from "@/lib/training-classes";
import { trainingClassInputSchema, TRAINING_CLASS_STATUS_VALUES } from "@/lib/validations/training-class";
import { parsePageParams, parseSearchParam, parseSortParams } from "@/lib/pagination";

type RouteParams = { params: Promise<{ companyId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());

    const { page, pageSize } = parsePageParams(searchParamsObject);
    const search = parseSearchParam(searchParamsObject);
    const { field: sort, dir } = parseSortParams(searchParamsObject, TRAINING_CLASS_SORT_FIELDS, "startsAt");

    const statusParam = searchParams.get("status");
    const status = (TRAINING_CLASS_STATUS_VALUES as readonly string[]).includes(statusParam ?? "")
      ? (statusParam as (typeof TRAINING_CLASS_STATUS_VALUES)[number])
      : undefined;

    const companyTrainingId = searchParams.get("companyTrainingId") ?? undefined;

    const { rows, total } = await getTrainingClassesPage(companyId, {
      page,
      pageSize,
      search: search || undefined,
      status,
      companyTrainingId,
      sort,
      dir,
    });

    return NextResponse.json({ trainingClasses: rows, total });
  } catch (error) {
    return handleApiError(error);
  }
}

// Decisão arquitetural (ver docs/portal-consultoria.md): a consultoria só
// cria turmas para treinamentos que ela mesma gerencia — nunca internos nem
// de outro prestador, mesmo com accessLevel OPERATION/ADMINISTRATION.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    const ctx = await requireSstCompanyOperationAccess(companyId);

    const body = await request.json();
    const input = trainingClassInputSchema.parse(body);
    await assertProviderManagesCompanyTraining(companyId, input.companyTrainingId, ctx.providerId);

    const trainingClass = await createTrainingClass(companyId, buildSstActor(ctx), input);

    return NextResponse.json({ trainingClass }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
