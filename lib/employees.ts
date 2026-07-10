import type { Prisma } from "@/app/generated/prisma/client";
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

export const EMPLOYEE_SORT_FIELDS = ["name", "document", "department", "position", "status"] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

function buildEmployeeOrderBy(
  sort: EmployeeSortField,
  dir: "asc" | "desc",
): Prisma.EmployeeOrderByWithRelationInput {
  switch (sort) {
    case "document":
      return { document: dir };
    case "department":
      return { department: { name: dir } };
    case "position":
      return { position: { name: dir } };
    case "status":
      return { status: dir };
    default:
      return { name: dir };
  }
}

export type EmployeesPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  positionId?: string;
  sort: EmployeeSortField;
  dir: "asc" | "desc";
};

/** Busca paginada/filtrada/ordenada no servidor — substitui o `findMany` sem
 * `take`/`skip` que carregava todos os colaboradores da empresa de uma vez
 * (ver docs/performance.md). */
export async function getEmployeesPage(companyId: string, params: EmployeesPageParams) {
  const { page, pageSize, search, departmentId, positionId, sort, dir } = params;

  const where: Prisma.EmployeeWhereInput = {
    companyId,
    ...(departmentId ? { departmentId } : {}),
    ...(positionId ? { positionId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { document: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      include: employeeListInclude,
      orderBy: buildEmployeeOrderBy(sort, dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

  return { rows, total };
}
