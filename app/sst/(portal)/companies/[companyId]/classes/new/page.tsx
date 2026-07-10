import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireSstCompanyOperationAccessOrDeny } from "@/lib/sst-auth";
import { SstClassForm } from "../sst-class-form";
import type { SearchParamsInput } from "@/lib/pagination";

export const metadata: Metadata = {
  title: "Nova turma — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }>; searchParams: Promise<SearchParamsInput> };

export default async function SstNewClassPage({ params, searchParams }: RouteParams) {
  const { companyId } = await params;
  const ctx = await requireSstCompanyOperationAccessOrDeny(companyId);
  const resolvedSearchParams = await searchParams;
  const trainingIdParam = resolvedSearchParams.trainingId;
  const defaultCompanyTrainingId = Array.isArray(trainingIdParam) ? trainingIdParam[0] : trainingIdParam;

  // Só treinamentos gerenciados por esta consultoria — decisão arquitetural
  // documentada em docs/portal-consultoria.md.
  const trainings = await prisma.companyTraining.findMany({
    where: {
      companyId,
      active: true,
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: ctx.providerId,
    },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  return <SstClassForm companyId={companyId} trainings={trainings} defaultCompanyTrainingId={defaultCompanyTrainingId} />;
}
