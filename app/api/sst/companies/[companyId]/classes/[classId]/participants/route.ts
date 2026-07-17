import { NextResponse } from "next/server";

import {
  buildSstActor,
  requireSstTrainingParticipantManageAccess,
  requireSstTrainingParticipantViewAccess,
} from "@/lib/sst-auth";
import { enrollTrainingClassParticipants, getParticipantsForClass } from "@/lib/training-participants";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import { trainingParticipantAddSchema } from "@/lib/validations/training-participant";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; classId: string }> };

// Sprint SST 1.4G, §25 — documento sempre mascarado nesta rota (mesma
// política de lib/sst-employees.ts para colaboradores).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, classId } = await params;
    await requireSstTrainingParticipantViewAccess(companyId, classId);

    const participants = await getParticipantsForClass(companyId, classId);
    const masked = participants.map((p) => ({ ...p, employee: { ...p.employee, document: maskEmployeeDocument(p.employee.document) } }));

    return NextResponse.json({ participants: masked });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, classId } = await params;
    const ctx = await requireSstTrainingParticipantManageAccess(companyId, classId);

    const body = await request.json();
    const input = trainingParticipantAddSchema.parse(body);
    const employeeIds = input.employeeIds?.length ? input.employeeIds : [input.employeeId!];

    const result = await enrollTrainingClassParticipants(companyId, buildSstActor(ctx), classId, employeeIds);
    const masked = {
      ...result,
      participants: result.participants.map((p) => ({ ...p, employee: { ...p.employee, document: maskEmployeeDocument(p.employee.document) } })),
    };

    return NextResponse.json(masked, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
