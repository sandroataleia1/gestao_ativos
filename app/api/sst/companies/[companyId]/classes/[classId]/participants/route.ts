import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildSstActor,
  requireSstCompanyOperationAccess,
  requireSstCompanyViewAccess,
} from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { addParticipants, getParticipantsForClass } from "@/lib/training-participants";
import { trainingParticipantAddSchema } from "@/lib/validations/training-participant";

type RouteParams = { params: Promise<{ companyId: string; classId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id: classId, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const participants = await getParticipantsForClass(companyId, classId);

    return NextResponse.json({ participants });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    const ctx = await requireSstCompanyOperationAccess(companyId);

    const trainingClass = await prisma.trainingClass.findFirst({
      where: { id: classId, companyId },
      select: { companyTrainingId: true },
    });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");
    await assertProviderManagesCompanyTraining(companyId, trainingClass.companyTrainingId, ctx.providerId);

    const body = await request.json();
    const input = trainingParticipantAddSchema.parse(body);
    const employeeIds = input.employeeIds?.length ? input.employeeIds : [input.employeeId!];

    const participants = await addParticipants(companyId, buildSstActor(ctx), classId, employeeIds);

    return NextResponse.json({ participants }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
