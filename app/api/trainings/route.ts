import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { createCompanyTraining, getCompanyTrainingsPage, TRAINING_SORT_FIELDS } from "@/lib/trainings";
import { companyTrainingInputSchema, TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import { parsePageParams, parseSearchParam, parseSortParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);

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

export async function POST(request: Request) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);

    const body = await request.json();
    const input = companyTrainingInputSchema.parse(body);

    const training = await createCompanyTraining(companyId, { id: user.id, name: user.name }, input);

    return NextResponse.json({ training }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
