import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { removeParticipant, updateParticipant } from "@/lib/training-participants";
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

// Remoção real (não soft-delete): só é permitida quando a turma ainda nem
// começou (SCHEDULED) — "remover" desfaz uma matrícula que nunca chegou a
// acontecer de fato. Ver docs/trainings-domain.md.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id, participantId } = await params;

    await removeParticipant(companyId, { id: user.id, name: user.name }, id, participantId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
