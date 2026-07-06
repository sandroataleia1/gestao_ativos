import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { positionInputSchema } from "@/lib/validations/department-position";

// Só criação — usado pelo botão "+" no cadastro de colaborador (ver
// app/(app)/employees/employee-form.tsx). Reaproveita EMPLOYEE_MANAGE:
// Cargo não tem permissão própria, é um sub-cadastro de colaborador.
export async function POST(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);

    const body = await request.json();
    const input = positionInputSchema.parse(body);

    const position = await prisma.position.create({ data: { ...input, companyId } });

    return NextResponse.json({ position }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
