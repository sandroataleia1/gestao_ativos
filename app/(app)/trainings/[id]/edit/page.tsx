import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getAuthorizedProvidersForTraining } from "@/lib/sst-providers";
import { TrainingForm } from "../../training-form";

export const metadata: Metadata = {
  title: "Editar treinamento — Gestão de Ativos",
};

export default async function EditTrainingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_MANAGE);

  const [training, templates, authorizedProvidersRaw] = await Promise.all([
    prisma.companyTraining.findFirst({
      where: { id, companyId },
      include: {
        managedByProvider: {
          select: {
            id: true,
            name: true,
            companyLinks: { where: { companyId }, select: { status: true } },
          },
        },
      },
    }),
    prisma.trainingTemplate.findMany({ where: { active: true }, orderBy: { title: "asc" } }),
    getAuthorizedProvidersForTraining(companyId),
  ]);

  if (!training) notFound();

  // Garante que o prestador atual do treinamento apareça no seletor mesmo
  // que o vínculo tenha sido suspenso/revogado depois — senão o <Select>
  // ficaria sem a opção correspondente ao valor atual (mesmo raciocínio já
  // usado para o template atual em app/(app)/trainings/classes/[id]/edit/page.tsx).
  const authorizedProviders =
    training.managedByProvider && !authorizedProvidersRaw.some((p) => p.id === training.managedByProvider!.id)
      ? [training.managedByProvider, ...authorizedProvidersRaw]
      : authorizedProvidersRaw;

  return <TrainingForm training={training} templates={templates} authorizedProviders={authorizedProviders} />;
}
