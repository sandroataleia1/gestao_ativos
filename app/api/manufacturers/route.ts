import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { manufacturerInputSchema } from "@/lib/validations/asset-lookups";

export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.MANUFACTURER_MANAGE);

    const manufacturers = await prisma.manufacturer.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ manufacturers });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.MANUFACTURER_MANAGE);

    const body = await request.json();
    const input = manufacturerInputSchema.parse(body);

    const manufacturer = await prisma.manufacturer.create({ data: { ...input, companyId } });

    return NextResponse.json({ manufacturer }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
