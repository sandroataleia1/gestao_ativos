import { NextResponse } from "next/server";

import { buildSstActor, requireSstTrainingParticipantManageAccess } from "@/lib/sst-auth";
import { cancelTrainingClassParticipant, updateParticipant } from "@/lib/training-participants";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { trainingParticipantUpdateSchema } from "@/lib/validations/training-participant";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; classId: string; participantId: string }> };

function maskParticipant<T extends { employee: { document: string } }>(participant: T) {
  return { ...participant, employee: { ...participant.employee, document: maskEmployeeDocument(participant.employee.document) } };
}

// Presença/resultado — escopo da Sprint SST 1.4H, preservado sem alteração
// funcional nesta sprint (só ganhou requireTrustedMutationOrigin, que
// faltava, e o guard consolidado com estado de Company — antes usava
// requireSstCompanyOperationAccess sem checar operationalStatus/controlStatus).
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, classId, participantId } = await params;
    const ctx = await requireSstTrainingParticipantManageAccess(companyId, classId);

    const body = await request.json();
    const input = trainingParticipantUpdateSchema.parse(body);

    const participant = await updateParticipant(companyId, buildSstActor(ctx), classId, participantId, input);

    return NextResponse.json({ participant: maskParticipant(participant) });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4G — remoção LÓGICA (nunca mais hard delete) — ver
// lib/training-participants.ts:cancelTrainingClassParticipant.
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, classId, participantId } = await params;
    const ctx = await requireSstTrainingParticipantManageAccess(companyId, classId);

    const participant = await cancelTrainingClassParticipant(companyId, buildSstActor(ctx), classId, participantId);

    return NextResponse.json({ participant: maskParticipant(participant) });
  } catch (error) {
    return handleApiError(error);
  }
}
