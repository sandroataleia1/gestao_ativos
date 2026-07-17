import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { cancelTrainingClassParticipant, updateParticipant } from "@/lib/training-participants";
import { trainingParticipantUpdateSchema } from "@/lib/validations/training-participant";

type RouteParams = { params: Promise<{ id: string; participantId: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id, participantId } = await params;

    const body = await request.json();
    const input = trainingParticipantUpdateSchema.parse(body);

    const participant = await updateParticipant(companyId, { id: user.id, name: user.name }, id, participantId, input);

    return NextResponse.json({ participant });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4G — remoção LÓGICA (nunca mais hard delete): só permitida
// enquanto a turma ainda está SCHEDULED. Preserva a linha (histórico +
// reentrada futura) — ver lib/training-participants.ts:cancelTrainingClassParticipant.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id, participantId } = await params;

    const participant = await cancelTrainingClassParticipant(companyId, { id: user.id, name: user.name }, id, participantId);

    return NextResponse.json({ participant });
  } catch (error) {
    return handleApiError(error);
  }
}
