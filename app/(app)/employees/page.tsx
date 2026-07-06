import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = {
  title: "Colaboradores — Gestão de Ativos",
};

export default async function EmployeesPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.EMPLOYEE_VIEW);
  const canManage = await hasPermission(PERMISSIONS.EMPLOYEE_MANAGE);

  const employees = await prisma.employee.findMany({
    where: { companyId },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Colaboradores</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os colaboradores da empresa.
        </p>
      </div>

      <EmployeesTable initialEmployees={employees} canManage={canManage} />
    </div>
  );
}
