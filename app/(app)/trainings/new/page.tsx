import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getAuthorizedProvidersForTraining } from "@/lib/sst-providers";
import { TrainingForm } from "../training-form";

export const metadata: Metadata = {
  title: "Novo treinamento — Gestão de Ativos",
};

export default async function NewTrainingPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_MANAGE);

  const [templates, authorizedProviders] = await Promise.all([
    prisma.trainingTemplate.findMany({
      where: { active: true },
      orderBy: { title: "asc" },
    }),
    getAuthorizedProvidersForTraining(companyId),
  ]);

  return <TrainingForm training={null} templates={templates} authorizedProviders={authorizedProviders} />;
}
