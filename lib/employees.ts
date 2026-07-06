import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/api-errors";
import type { EmployeeInput } from "@/lib/validations/employee";

/**
 * Garante que `departmentId`/`positionId` (quando informados) existem e
 * pertencem à empresa atual — nunca confia apenas no formato do id vindo do
 * client.
 */
export async function assertReferencesBelongToCompany(
  companyId: string,
  input: Pick<EmployeeInput, "departmentId" | "positionId">,
) {
  if (input.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.departmentId, companyId },
      select: { id: true },
    });
    if (!department) {
      throw new ValidationError("Departamento inválido.");
    }
  }

  if (input.positionId) {
    const position = await prisma.position.findFirst({
      where: { id: input.positionId, companyId },
      select: { id: true },
    });
    if (!position) {
      throw new ValidationError("Cargo inválido.");
    }
  }
}

export const employeeListInclude = {
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
} as const;
