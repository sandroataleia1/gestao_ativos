import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { generateAttendanceList, generateCertificate, getTrainingClassDocuments } from "@/lib/training-documents";
import { trainingClassDocumentInputSchema } from "@/lib/validations/training-document";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const documents = await getTrainingClassDocuments(companyId, id);

    return NextResponse.json({ documents });
  } catch (error) {
    return handleApiError(error);
  }
}

// Sprint SST 1.4H, fatia 2 — gera lista de presença (documento único da
// turma) ou certificado (documento individual do participante), conforme
// `type`. Ver lib/training-documents.ts para as regras de negócio
// (requiresAttendanceList/requiresCertificate, porta de status, APPROVED).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id } = await params;

    const trainingClass = await prisma.trainingClass.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!trainingClass) throw new NotFoundError("Turma não encontrada.");

    const body = await request.json();
    const input = trainingClassDocumentInputSchema.parse(body);
    const actor = { id: user.id, name: user.name };

    const document =
      input.type === "ATTENDANCE_LIST"
        ? await generateAttendanceList(companyId, actor, id)
        : await generateCertificate(companyId, actor, id, input.participantId);

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
