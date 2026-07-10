import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { TrainingClassEditForm } from "../../training-class-edit-form";

export const metadata: Metadata = {
  title: "Editar turma — Gestão de Ativos",
};

export default async function EditTrainingClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_MANAGE);

  const [trainingClass, activeCompanyTrainings] = await Promise.all([
    prisma.trainingClass.findFirst({ where: { id, companyId } }),
    prisma.companyTraining.findMany({
      where: { companyId, active: true },
      select: { id: true, title: true, trainingType: true, category: true },
      orderBy: { title: "asc" },
    }),
  ]);

  if (!trainingClass) notFound();

  // Garante que o treinamento atual da turma apareça no seletor mesmo que
  // tenha sido desativado depois da turma criada — senão o <Select> ficaria
  // sem a opção correspondente ao valor atual.
  let companyTrainings = activeCompanyTrainings;
  if (!activeCompanyTrainings.some((t) => t.id === trainingClass.companyTrainingId)) {
    const currentTraining = await prisma.companyTraining.findUnique({
      where: { id: trainingClass.companyTrainingId },
      select: { id: true, title: true, trainingType: true, category: true },
    });
    if (currentTraining) companyTrainings = [currentTraining, ...activeCompanyTrainings];
  }

  return <TrainingClassEditForm trainingClass={trainingClass} companyTrainings={companyTrainings} />;
}
