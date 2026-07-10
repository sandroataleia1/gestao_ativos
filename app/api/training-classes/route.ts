import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { createTrainingClass, getTrainingClassesPage, TRAINING_CLASS_SORT_FIELDS } from "@/lib/training-classes";
import { trainingClassInputSchema, TRAINING_CLASS_STATUS_VALUES } from "@/lib/validations/training-class";
import { parsePageParams, parseSearchParam, parseSortParams } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);

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

// Toda turma nova nasce SCHEDULED — não há etapa de status no wizard de
// criação (ver app/(app)/trainings/classes/training-class-wizard.tsx). O
// status só muda depois, via PUT (sempre validado pela state machine em
// lib/training-classes.ts).
export async function POST(request: Request) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);

    const body = await request.json();
    const input = trainingClassInputSchema.parse(body);

    const trainingClass = await createTrainingClass(companyId, { id: user.id, name: user.name }, input);

    return NextResponse.json({ trainingClass }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
