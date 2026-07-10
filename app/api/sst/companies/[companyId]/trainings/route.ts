import { NextResponse } from "next/server";

import { buildSstActor, requireSstCompanyAdministrationAccess, requireSstCompanyViewAccess } from "@/lib/sst-auth";
import { handleApiError } from "@/lib/api-errors";
import { createCompanyTraining, getCompanyTrainingsPage, TRAINING_SORT_FIELDS } from "@/lib/trainings";
import { companyTrainingInputSchema, TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import { parsePageParams, parseSearchParam, parseSortParams } from "@/lib/pagination";

type RouteParams = { params: Promise<{ companyId: string }> };

// Lista TODOS os treinamentos da empresa (não só os gerenciados por este
// provider) — a consultoria precisa de contexto do que já existe, mesmo
// que não possa editar tudo (ver classifyTrainingManagementLabel,
// lib/sst-trainings.ts, usado pela UI para o badge de gestão).
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const { searchParams } = new URL(request.url);
    const searchParamsObject = Object.fromEntries(searchParams.entries());

    const { page, pageSize } = parsePageParams(searchParamsObject);
    const search = parseSearchParam(searchParamsObject);
    const { field: sort, dir } = parseSortParams(searchParamsObject, TRAINING_SORT_FIELDS, "title");

    const trainingTypeParam = searchParams.get("trainingType");
    const trainingType = (TRAINING_TYPE_VALUES as readonly string[]).includes(trainingTypeParam ?? "")
      ? (trainingTypeParam as (typeof TRAINING_TYPE_VALUES)[number])
      : undefined;

    const mandatoryParam = searchParams.get("mandatory");
    const mandatory = mandatoryParam === "true" ? true : mandatoryParam === "false" ? false : undefined;

    const activeParam = searchParams.get("active");
    const active = activeParam === "true" ? true : activeParam === "false" ? false : undefined;

    const { rows, total } = await getCompanyTrainingsPage(companyId, {
      page,
      pageSize,
      search: search || undefined,
      trainingType,
      mandatory,
      active,
      sort,
      dir,
    });

    return NextResponse.json({ trainings: rows, total });
  } catch (error) {
    return handleApiError(error);
  }
}

// managementMode/managedByProviderId nunca vêm do client — sempre forçados
// para EXTERNAL_PROVIDER + o provider da sessão, mesmo que o body mande
// outra coisa (ver docs/portal-consultoria.md).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    const ctx = await requireSstCompanyAdministrationAccess(companyId);

    const body = await request.json();
    const parsed = companyTrainingInputSchema.parse(body);
    const input = { ...parsed, managementMode: "EXTERNAL_PROVIDER" as const, managedByProviderId: ctx.providerId };

    const training = await createCompanyTraining(companyId, buildSstActor(ctx), input);

    return NextResponse.json({ training }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
