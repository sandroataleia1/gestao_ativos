import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildSstActor,
  requireSstCompanyOperationAccess,
  requireSstCompanyViewAccess,
} from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { updateTrainingClass } from "@/lib/training-classes";
import { trainingClassInputSchema } from "@/lib/validations/training-class";

type RouteParams = { params: Promise<{ companyId: string; classId: string }> };

const companyTrainingSelect = { companyTraining: { select: { id: true, title: true } } } as const;

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const trainingClass = await prisma.trainingClass.findFirst({
      where: { id: classId, companyId },
      include: companyTrainingSelect,
    });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    return NextResponse.json({ trainingClass });
  } catch (error) {
    return handleApiError(error);
  }
}

// Só edita turmas de treinamentos gerenciados por este provider — checa
// tanto o treinamento atual da turma quanto o do payload (caso o edit
// tente reatribuir a turma a outro treinamento).
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    const ctx = await requireSstCompanyOperationAccess(companyId);

    const existing = await prisma.trainingClass.findFirst({
      where: { id: classId, companyId },
      select: { status: true, companyTrainingId: true },
    });
    if (!existing) throw new NotFoundError("Turma não encontrada.");
    await assertProviderManagesCompanyTraining(companyId, existing.companyTrainingId, ctx.providerId);

    const body = await request.json();
    const input = trainingClassInputSchema.parse(body);
    await assertProviderManagesCompanyTraining(companyId, input.companyTrainingId, ctx.providerId);

    const trainingClass = await updateTrainingClass(
      companyId,
      buildSstActor(ctx),
      classId,
      existing.status,
      input,
    );

    return NextResponse.json({ trainingClass });
  } catch (error) {
    return handleApiError(error);
  }
}
