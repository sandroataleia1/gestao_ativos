import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { updateTrainingClass } from "@/lib/training-classes";
import { trainingClassInputSchema } from "@/lib/validations/training-class";

type RouteParams = { params: Promise<{ id: string }> };

const companyTrainingSelect = { companyTraining: { select: { id: true, title: true } } } as const;

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({
      where: { id, companyId },
      include: companyTrainingSelect,
    });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    return NextResponse.json({ trainingClass });
  } catch (error) {
    return handleApiError(error);
  }
}

// Único caminho para mudar o status (SCHEDULED → IN_PROGRESS/COMPLETED, ou
// CANCELLED a partir de SCHEDULED/IN_PROGRESS) — não existe DELETE para
// turma (requisito: "Não apagar turmas. Usar status."). A transição em si é
// validada por assertTrainingClassTransition dentro de updateTrainingClass
// (lib/training-classes.ts) — ver docs/training-architecture.md.
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id } = await params;

    const existing = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { status: true } });
    if (!existing) throw new NotFoundError("Turma não encontrada.");

    const body = await request.json();
    const input = trainingClassInputSchema.parse(body);

    const trainingClass = await updateTrainingClass(
      companyId,
      { id: user.id, name: user.name },
      id,
      existing.status,
      input,
    );

    return NextResponse.json({ trainingClass });
  } catch (error) {
    return handleApiError(error);
  }
}
