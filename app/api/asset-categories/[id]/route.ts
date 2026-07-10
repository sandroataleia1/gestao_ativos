import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { assetCategoryInputSchema } from "@/lib/validations/asset-lookups";
import { invalidateCompanyData } from "@/lib/cache";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CATEGORY_MANAGE);
    const { id } = await params;

    const existing = await prisma.assetCategory.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Categoria não encontrada.");

    const body = await request.json();
    const input = assetCategoryInputSchema.parse(body);

    const category = await prisma.assetCategory.update({ where: { id }, data: input });

    invalidateCompanyData(companyId, ["reports-lookups"]);
    return NextResponse.json({ category });
  } catch (error) {
    return handleApiError(error);
  }
}

// Nunca apaga a linha: Asset pode referenciar esta categoria. "Excluir" só
// desativa (active: false, deletedAt: now) — reaparece a qualquer momento
// desmarcando "Ativo" na edição.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CATEGORY_MANAGE);
    const { id } = await params;

    const existing = await prisma.assetCategory.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Categoria não encontrada.");

    const category = await prisma.assetCategory.update({
      where: { id },
      data: { active: false, deletedAt: new Date() },
    });

    invalidateCompanyData(companyId, ["reports-lookups"]);
    return NextResponse.json({ category });
  } catch (error) {
    return handleApiError(error);
  }
}
