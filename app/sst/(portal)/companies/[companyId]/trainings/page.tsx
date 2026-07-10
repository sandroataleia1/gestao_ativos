import type { Metadata } from "next";

import { requireSstProviderCompanyAccessOrDeny, sstCanAdminister, sstCanOperate } from "@/lib/sst-auth";
import { getCompanyTrainingsPage, TRAINING_SORT_FIELDS } from "@/lib/trainings";
import { classifyTrainingManagementLabel } from "@/lib/sst-trainings";
import { TRAINING_TYPE_VALUES } from "@/lib/validations/training";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { SstTrainingsTable } from "./sst-trainings-table";

export const metadata: Metadata = {
  title: "Treinamentos — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }>; searchParams: Promise<SearchParamsInput> };

// Lista TODOS os treinamentos da empresa (não só os gerenciados por esta
// consultoria) — dá contexto de quem gerencia o quê, mesmo que a maioria
// não seja editável por aqui (ver SstTrainingsTable/management-badge).
export default async function SstTrainingsPage({ params, searchParams }: RouteParams) {
  const { companyId } = await params;
  const ctx = await requireSstProviderCompanyAccessOrDeny(companyId);
  const canAdminister = sstCanAdminister(ctx);
  const canOperate = sstCanOperate(ctx);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, TRAINING_SORT_FIELDS, "title");

  const trainingTypeParam = resolvedSearchParams.trainingType as string | undefined;
  const trainingType = (TRAINING_TYPE_VALUES as readonly string[]).includes(trainingTypeParam ?? "")
    ? (trainingTypeParam as (typeof TRAINING_TYPE_VALUES)[number])
    : undefined;

  const { rows, total } = await getCompanyTrainingsPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    trainingType,
    sort,
    dir,
  });
  // Classificação calculada aqui (Server Component, pode importar
  // lib/sst-trainings.ts sem problema) e passada já pronta para a tabela
  // client — evita que o client component precise importar um módulo que
  // também usa Prisma (não daria bundle no browser).
  const trainings = rows.map((training) => ({
    ...training,
    managementLabel: classifyTrainingManagementLabel(training, ctx.providerId),
  }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Treinamentos</h1>
        <p className="text-sm text-muted-foreground">
          Treinamentos cadastrados por esta empresa — edite apenas os que sua consultoria gerencia.
        </p>
      </div>

      <SstTrainingsTable
        companyId={companyId}
        trainings={trainings}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        canAdminister={canAdminister}
        canOperate={canOperate}
      />
    </div>
  );
}
