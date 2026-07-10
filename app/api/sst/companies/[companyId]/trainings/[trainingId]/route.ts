import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildSstActor,
  requireSstCompanyAdministrationAccess,
  requireSstCompanyViewAccess,
} from "@/lib/sst-auth";
import { assertProviderManagesCompanyTraining } from "@/lib/sst-trainings";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { deactivateCompanyTraining, managedByProviderSelect, updateCompanyTraining } from "@/lib/trainings";
import { companyTrainingInputSchema } from "@/lib/validations/training";

type RouteParams = { params: Promise<{ companyId: string; trainingId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, trainingId } = await params;
    await requireSstCompanyViewAccess(companyId);

    const training = await prisma.companyTraining.findFirst({
      where: { id: trainingId, companyId },
      include: managedByProviderSelect(companyId),
    });
    if (!training) throw new NotFoundError("Treinamento não encontrado.");

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}

// Só edita treinamentos que este provider gerencia — mesmo se o vínculo for
// ADMINISTRATION, não há exceção para editar treinamento interno/de outro
// provider (decisão documentada em docs/portal-consultoria.md).
// managementMode/managedByProviderId nunca vêm do client, sempre forçados.
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId, trainingId } = await params;
    const ctx = await requireSstCompanyAdministrationAccess(companyId);
    await assertProviderManagesCompanyTraining(companyId, trainingId, ctx.providerId);

    const body = await request.json();
    const parsed = companyTrainingInputSchema.parse(body);
    const input = { ...parsed, managementMode: "EXTERNAL_PROVIDER" as const, managedByProviderId: ctx.providerId };

    const training = await updateCompanyTraining(companyId, buildSstActor(ctx), trainingId, input);

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}

// Soft delete apenas (active: false) — mesma semântica do Portal Empresa.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, trainingId } = await params;
    const ctx = await requireSstCompanyAdministrationAccess(companyId);
    await assertProviderManagesCompanyTraining(companyId, trainingId, ctx.providerId);

    const training = await deactivateCompanyTraining(companyId, buildSstActor(ctx), trainingId);

    return NextResponse.json({ training });
  } catch (error) {
    return handleApiError(error);
  }
}
