import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { manufacturerInputSchema } from "@/lib/validations/asset-lookups";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.MANUFACTURER_MANAGE);
    const { id } = await params;

    const existing = await prisma.manufacturer.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Fabricante não encontrado.");

    const body = await request.json();
    const input = manufacturerInputSchema.parse(body);

    const manufacturer = await prisma.manufacturer.update({ where: { id }, data: input });

    return NextResponse.json({ manufacturer });
  } catch (error) {
    return handleApiError(error);
  }
}

// Nunca apaga a linha: Asset pode referenciar este fabricante. Manufacturer
// não tem coluna `active` (só `deletedAt`) — não há reativação pela UI
// nesta entrega; um fabricante excluído fica oculto da lista/seleção.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.MANUFACTURER_MANAGE);
    const { id } = await params;

    const existing = await prisma.manufacturer.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Fabricante não encontrado.");

    const manufacturer = await prisma.manufacturer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ manufacturer });
  } catch (error) {
    return handleApiError(error);
  }
}
