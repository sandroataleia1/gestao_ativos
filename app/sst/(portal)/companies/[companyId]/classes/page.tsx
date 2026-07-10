import type { Metadata } from "next";

import { requireSstProviderCompanyAccessOrDeny, sstCanOperate } from "@/lib/sst-auth";
import { getTrainingClassesPage, TRAINING_CLASS_SORT_FIELDS } from "@/lib/training-classes";
import { TRAINING_CLASS_STATUS_VALUES } from "@/lib/validations/training-class";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { SstClassesTable } from "./sst-classes-table";

export const metadata: Metadata = {
  title: "Turmas — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }>; searchParams: Promise<SearchParamsInput> };

export default async function SstClassesPage({ params, searchParams }: RouteParams) {
  const { companyId } = await params;
  const ctx = await requireSstProviderCompanyAccessOrDeny(companyId);
  const canOperate = sstCanOperate(ctx);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, TRAINING_CLASS_SORT_FIELDS, "startsAt");

  const statusParam = resolvedSearchParams.status as string | undefined;
  const status = (TRAINING_CLASS_STATUS_VALUES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof TRAINING_CLASS_STATUS_VALUES)[number])
    : undefined;

  const { rows: trainingClasses, total } = await getTrainingClassesPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    status,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Turmas</h1>
        <p className="text-sm text-muted-foreground">
          Turmas agendadas para os treinamentos desta empresa.
        </p>
      </div>

      <SstClassesTable
        companyId={companyId}
        trainingClasses={trainingClasses}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        canOperate={canOperate}
      />
    </div>
  );
}
