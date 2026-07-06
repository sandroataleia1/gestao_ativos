import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { assertAssetReferencesBelongToCompany, assetListInclude } from "@/lib/assets";
import { assetInputSchema } from "@/lib/validations/asset";
import { CA_STATUS_VALUES, buildCaStatusWhere, upsertAssetCertification } from "@/lib/certifications";

export async function GET(request: NextRequest) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ASSET_VIEW);

    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim();
    const categoryId = params.get("categoryId")?.trim();
    const statusId = params.get("statusId")?.trim();
    const conditionId = params.get("conditionId")?.trim();
    const caStatusParam = params.get("caStatus")?.trim();
    const caStatus = CA_STATUS_VALUES.find((value) => value === caStatusParam);

    const assets = await prisma.asset.findMany({
      where: {
        companyId,
        ...(categoryId ? { categoryId } : {}),
        ...(statusId ? { statusId } : {}),
        ...(conditionId ? { conditionId } : {}),
        ...(caStatus ? buildCaStatusWhere(caStatus) : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { assetCode: { contains: q, mode: "insensitive" } },
                { category: { name: { contains: q, mode: "insensitive" } } },
                { manufacturer: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: assetListInclude,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ assets });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ASSET_MANAGE);

    const body = await request.json();
    const { certification, ...input } = assetInputSchema.parse(body);
    await assertAssetReferencesBelongToCompany(companyId, input);

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({ data: { ...input, companyId } });

      if (certification) {
        await upsertAssetCertification(tx, companyId, created.id, certification);
      }

      return tx.asset.findUniqueOrThrow({
        where: { id: created.id },
        include: assetListInclude,
      });
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
