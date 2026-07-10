import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildSstActor, requireSstCompanyOperationAccess } from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { removeParticipant, updateParticipant } from "@/lib/training-participants";
import { trainingParticipantUpdateSchema } from "@/lib/validations/training-participant";

type RouteParams = { params: Promise<{ companyId: string; classId: string; participantId: string }> };

async function assertClassManagedByProvider(companyId: string, classId: string, providerId: string) {
  const trainingClass = await prisma.trainingClass.findFirst({
    where: { id: classId, companyId },
    select: { companyTrainingId: true },
  });
  if (!trainingClass) throw new NotFoundError("Turma não encontrada.");
  await assertProviderManagesCompanyTraining(companyId, trainingClass.companyTrainingId, providerId);
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId, participantId } = await params;
    const ctx = await requireSstCompanyOperationAccess(companyId);
    await assertClassManagedByProvider(companyId, classId, ctx.providerId);

    const body = await request.json();
    const input = trainingParticipantUpdateSchema.parse(body);

    const participant = await updateParticipant(companyId, buildSstActor(ctx), classId, participantId, input);

    return NextResponse.json({ participant });
  } catch (error) {
    return handleApiError(error);
  }
}

// Remoção real (não soft-delete) — só permitida quando a turma ainda nem
// começou (SCHEDULED), regra já aplicada dentro de removeParticipant.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId, participantId } = await params;
    const ctx = await requireSstCompanyOperationAccess(companyId);
    await assertClassManagedByProvider(companyId, classId, ctx.providerId);

    await removeParticipant(companyId, buildSstActor(ctx), classId, participantId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
