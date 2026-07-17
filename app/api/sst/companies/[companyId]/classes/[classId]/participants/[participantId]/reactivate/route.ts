import { NextResponse } from "next/server";

import { buildSstActor, requireSstTrainingParticipantManageAccess } from "@/lib/sst-auth";
import { reactivateTrainingClassParticipant } from "@/lib/training-participants";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; classId: string; participantId: string }> };

// Sprint SST 1.4G — reentrada explícita a partir da própria listagem de
// participantes — ver lib/training-participants.ts:reactivateTrainingClassParticipant.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, classId, participantId } = await params;
    const ctx = await requireSstTrainingParticipantManageAccess(companyId, classId);

    const participant = await reactivateTrainingClassParticipant(companyId, buildSstActor(ctx), classId, participantId);

    return NextResponse.json({
      participant: { ...participant, employee: { ...participant.employee, document: maskEmployeeDocument(participant.employee.document) } },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
