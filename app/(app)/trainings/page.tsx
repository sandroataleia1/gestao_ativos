import type { Metadata } from "next";

import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getCompanyTrainingsPage, TRAINING_SORT_FIELDS } from "@/lib/trainings";
import { TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { TrainingsTable } from "./trainings-table";

export const metadata: Metadata = {
  title: "Treinamentos — Gestão de Ativos",
};

export default async function TrainingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_VIEW);
  const canManage = await hasPermission(PERMISSIONS.TRAINING_MANAGE);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, TRAINING_SORT_FIELDS, "title");

  const trainingTypeParam = resolvedSearchParams.trainingType as string | undefined;
  const trainingType = (TRAINING_TYPE_VALUES as readonly string[]).includes(trainingTypeParam ?? "")
    ? (trainingTypeParam as (typeof TRAINING_TYPE_VALUES)[number])
    : undefined;

  const mandatoryParam = resolvedSearchParams.mandatory as string | undefined;
  const mandatory = mandatoryParam === "true" ? true : mandatoryParam === "false" ? false : undefined;

  const activeParam = resolvedSearchParams.active as string | undefined;
  const active = activeParam === "true" ? true : activeParam === "false" ? false : undefined;

  const { rows: trainings, total } = await getCompanyTrainingsPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    trainingType,
    mandatory,
    active,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Treinamentos</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie o catálogo de treinamentos da empresa.
        </p>
      </div>

      <TrainingsTable
        initialTrainings={trainings}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        canManage={canManage}
      />
    </div>
  );
}
