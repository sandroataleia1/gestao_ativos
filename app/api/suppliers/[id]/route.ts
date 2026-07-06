import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { supplierInputSchema } from "@/lib/validations/asset-lookups";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);
    const { id } = await params;

    const existing = await prisma.supplier.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Fornecedor não encontrado.");

    const body = await request.json();
    const input = supplierInputSchema.parse(body);

    const supplier = await prisma.supplier.update({ where: { id }, data: input });

    return NextResponse.json({ supplier });
  } catch (error) {
    return handleApiError(error);
  }
}

// Nunca apaga a linha: Asset pode referenciar este fornecedor. "Excluir" só
// desativa (active: false) — reativa desmarcando "Inativo" na edição.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);
    const { id } = await params;

    const existing = await prisma.supplier.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Fornecedor não encontrado.");

    const supplier = await prisma.supplier.update({ where: { id }, data: { active: false } });

    return NextResponse.json({ supplier });
  } catch (error) {
    return handleApiError(error);
  }
}
