import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { assetCategoryInputSchema } from "@/lib/validations/asset-lookups";
import { invalidateCompanyData } from "@/lib/cache";

export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CATEGORY_MANAGE);

    const categories = await prisma.assetCategory.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ categories });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CATEGORY_MANAGE);

    const body = await request.json();
    const input = assetCategoryInputSchema.parse(body);

    const category = await prisma.assetCategory.create({ data: { ...input, companyId } });

    invalidateCompanyData(companyId, ["reports-lookups"]);
    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
