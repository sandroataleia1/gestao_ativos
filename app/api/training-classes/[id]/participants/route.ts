import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { enrollTrainingClassParticipants, getParticipantsForClass } from "@/lib/training-participants";
import { trainingParticipantAddSchema } from "@/lib/validations/training-participant";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const participants = await getParticipantsForClass(companyId, id);

    return NextResponse.json({ participants });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4G — inscrição idempotente/ciente de reentrada (ver
// lib/training-participants.ts:enrollTrainingClassParticipants). A resposta
// inclui created/reactivated/alreadyEnrolled/totalEnrolled/remainingCapacity
// para a UI atualizar o contador sem uma segunda chamada.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const body = await request.json();
    const input = trainingParticipantAddSchema.parse(body);
    const employeeIds = input.employeeIds?.length ? input.employeeIds : [input.employeeId!];

    const result = await enrollTrainingClassParticipants(companyId, { id: user.id, name: user.name }, id, employeeIds);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
