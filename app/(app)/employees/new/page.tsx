import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = {
  title: "Novo colaborador — Gestão de Ativos",
};

export default async function NewEmployeePage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.EMPLOYEE_MANAGE);

  const [departments, positions] = await Promise.all([
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

  return <EmployeeForm employee={null} departments={departments} positions={positions} />;
}
