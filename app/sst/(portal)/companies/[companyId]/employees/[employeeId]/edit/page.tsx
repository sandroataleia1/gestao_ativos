import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSstProviderEmployeeManageAccessOrDeny } from "@/lib/sst-auth";
import { SstEmployeeForm } from "../../sst-employee-form";

export const metadata: Metadata = {
  title: "Editar colaborador — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

export default async function EditSstEmployeePage({ params }: RouteParams) {
  const { companyId, employeeId } = await params;
  await requireSstProviderEmployeeManageAccessOrDeny(companyId);

  const [employee, departments, positions] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true,
        name: true,
        document: true,
        email: true,
        phone: true,
        registration: true,
        departmentId: true,
        positionId: true,
        status: true,
      },
    }),
    prisma.department.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.position.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  if (!employee) notFound();

  return <SstEmployeeForm companyId={companyId} employee={employee} departments={departments} positions={positions} />;
}
