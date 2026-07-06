import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { supplierInputSchema } from "@/lib/validations/asset-lookups";

export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

    const suppliers = await prisma.supplier.findMany({
      where: { companyId },
      orderBy: { corporateName: "asc" },
    });

    return NextResponse.json({ suppliers });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

    const body = await request.json();
    const input = supplierInputSchema.parse(body);

    const supplier = await prisma.supplier.create({ data: { ...input, companyId } });

    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
