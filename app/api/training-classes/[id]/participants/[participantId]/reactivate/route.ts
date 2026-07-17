import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { reactivateTrainingClassParticipant } from "@/lib/training-participants";

type RouteParams = { params: Promise<{ id: string; participantId: string }> };

// Sprint SST 1.4G — reentrada explícita a partir da própria listagem de
// participantes (reativa uma inscrição CANCELLED sem passar pelo seletor).
// Mesma linha, nunca uma segunda inscrição — ver
// lib/training-participants.ts:reactivateTrainingClassParticipant.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id, participantId } = await params;

    const participant = await reactivateTrainingClassParticipant(companyId, { id: user.id, name: user.name }, id, participantId);

    return NextResponse.json({ participant });
  } catch (error) {
    return handleApiError(error);
  }
}
