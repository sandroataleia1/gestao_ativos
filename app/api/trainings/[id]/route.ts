import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { deactivateCompanyTraining, managedByProviderSelect, updateCompanyTraining } from "@/lib/trainings";
import { companyTrainingInputSchema } from "@/lib/validations/training";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.TRAINING_VIEW);
    const { id } = await params;

    const training = await prisma.companyTraining.findFirst({
      where: { id, companyId },
      include: managedByProviderSelect(companyId),
    });
    if (!training) throw new NotFoundError("Treinamento não encontrado.");

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id } = await params;

    const existing = await prisma.companyTraining.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Treinamento não encontrado.");

    const body = await request.json();
    const input = companyTrainingInputSchema.parse(body);

    // Editar nunca re-copia do template — trainingTemplateId é imutável
    // após a criação, mesmo que venha no payload.
    const training = await updateCompanyTraining(companyId, { id: user.id, name: user.name }, id, input);

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}

// Nunca apaga a linha: soft delete via active=false — ver
// docs/trainings-domain.md.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.TRAINING_MANAGE);
    const { id } = await params;

    const existing = await prisma.companyTraining.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Treinamento não encontrado.");

    const training = await deactivateCompanyTraining(companyId, { id: user.id, name: user.name }, id);

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}
