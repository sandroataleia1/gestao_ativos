import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { assertAssetReferencesBelongToCompany, assetListInclude } from "@/lib/assets";
import { assetInputSchema } from "@/lib/validations/asset";
import { upsertAssetCertification } from "@/lib/certifications";
import { logAudit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ASSET_VIEW);
    const { id } = await params;

    const asset = await prisma.asset.findFirst({
      where: { id, companyId },
      include: assetListInclude,
    });
    if (!asset) throw new NotFoundError("Ativo não encontrado.");

    return NextResponse.json({ asset });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ASSET_MANAGE);
    const { id } = await params;

    const existing = await prisma.asset.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Ativo não encontrado.");

    const body = await request.json();
    const { certification, ...input } = assetInputSchema.parse(body);
    await assertAssetReferencesBelongToCompany(companyId, input);

    const asset = await prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: input });

      if (certification) {
        await upsertAssetCertification(tx, companyId, id, certification);
      }

      return tx.asset.findUniqueOrThrow({ where: { id }, include: assetListInclude });
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return handleApiError(error);
  }
}

// Nunca apaga a linha: o cadastro mestre pode estar referenciado por
// AssetUnit/AssetMovement/StockMovement/StockBalance (imutáveis por design).
// "Excluir" na UI sempre desativa (active: false, deletedAt: now) — seguro
// independentemente de haver ou não vínculos.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.ASSET_MANAGE);
    const { id } = await params;

    const existing = await prisma.asset.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, assetCode: true },
    });
    if (!existing) throw new NotFoundError("Ativo não encontrado.");

    const asset = await prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
        include: assetListInclude,
      });

      await logAudit(tx, {
        companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "asset.delete",
        targetType: "Asset",
        targetId: id,
        targetLabel: `${existing.name} (${existing.assetCode})`,
      });

      return updated;
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return handleApiError(error);
  }
}
