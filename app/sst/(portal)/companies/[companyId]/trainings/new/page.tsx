import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireSstCompanyAdministrationAccessOrDeny } from "@/lib/sst-auth";
import { SstTrainingForm } from "../sst-training-form";

export const metadata: Metadata = {
  title: "Novo treinamento — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }> };

export default async function SstNewTrainingPage({ params }: RouteParams) {
  const { companyId } = await params;
  await requireSstCompanyAdministrationAccessOrDeny(companyId);

  const templates = await prisma.trainingTemplate.findMany({ where: { active: true }, orderBy: { title: "asc" } });

  return <SstTrainingForm companyId={companyId} training={null} templates={templates} />;
}
