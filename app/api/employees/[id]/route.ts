import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { assertReferencesBelongToCompany, employeeListInclude } from "@/lib/employees";
import { employeeInputSchema } from "@/lib/validations/employee";
import { logAudit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.EMPLOYEE_VIEW);
    const { id } = await params;

    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      include: employeeListInclude,
    });
    if (!employee) throw new NotFoundError("Colaborador não encontrado.");

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
    const { id } = await params;

    const existing = await prisma.employee.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Colaborador não encontrado.");

    const body = await request.json();
    const input = employeeInputSchema.parse(body);
    await assertReferencesBelongToCompany(companyId, input);

    const employee = await prisma.employee.update({
      where: { id },
      data: input,
      include: employeeListInclude,
    });

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}

// Soft delete: marca o colaborador como INACTIVE. Nunca remove a linha —
// preserva o histórico caso movimentações/custódias venham a referenciá-lo.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.EMPLOYEE_MANAGE);
    const { id } = await params;

    const existing = await prisma.employee.findFirst({
      where: { id, companyId },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundError("Colaborador não encontrado.");

    const employee = await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: { status: "INACTIVE" },
        include: employeeListInclude,
      });

      // targetLabel só com o nome — nunca o documento (CPF), que é dado
      // sensível (ver docs/observability.md).
      await logAudit(tx, {
        companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "employee.delete",
        targetType: "Employee",
        targetId: id,
        targetLabel: existing.name,
      });

      return updated;
    });

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}
