import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { employeeListInclude } from "@/lib/employees";
import { EmployeeForm } from "../../employee-form";

export const metadata: Metadata = {
  title: "Editar colaborador — Gestão de Ativos",
};

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.EMPLOYEE_MANAGE);

  const [employee, departments, positions] = await Promise.all([
    prisma.employee.findFirst({
      where: { id, companyId },
      include: employeeListInclude,
    }),
    prisma.department.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!employee) notFound();

  return <EmployeeForm employee={employee} departments={departments} positions={positions} />;
}
