import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSstCompanyAdministrationAccessOrDeny } from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { SstTrainingForm } from "../../sst-training-form";

export const metadata: Metadata = {
  title: "Editar treinamento — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string; trainingId: string }> };

export default async function SstEditTrainingPage({ params }: RouteParams) {
  const { companyId, trainingId } = await params;
  const ctx = await requireSstCompanyAdministrationAccessOrDeny(companyId);

  // Só pode editar o que a própria consultoria gerencia — mesma regra da
  // API (assertProviderManagesCompanyTraining), aqui checada antes de
  // renderizar o formulário em vez de deixar a página quebrar no submit.
  try {
    await assertProviderManagesCompanyTraining(companyId, trainingId, ctx.providerId);
  } catch {
    notFound();
  }

  const [training, templates] = await Promise.all([
    prisma.companyTraining.findFirst({ where: { id: trainingId, companyId } }),
    prisma.trainingTemplate.findMany({ where: { active: true }, orderBy: { title: "asc" } }),
  ]);
  if (!training) notFound();

  return <SstTrainingForm companyId={companyId} training={training} templates={templates} />;
}
