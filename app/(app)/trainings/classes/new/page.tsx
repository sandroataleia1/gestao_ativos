import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { TrainingClassWizard } from "../training-class-wizard";

export const metadata: Metadata = {
  title: "Nova turma — Gestão de Ativos",
};

export default async function NewTrainingClassPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_MANAGE);

  const companyTrainings = await prisma.companyTraining.findMany({
    where: { companyId, active: true },
    select: { id: true, title: true, trainingType: true, category: true },
    orderBy: { title: "asc" },
  });

  return <TrainingClassWizard companyTrainings={companyTrainings} />;
}
