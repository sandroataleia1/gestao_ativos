import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireSstProviderEmployeeManageAccessOrDeny } from "@/lib/sst-auth";
import { SstEmployeeForm } from "../sst-employee-form";

export const metadata: Metadata = {
  title: "Novo colaborador — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }> };

export default async function NewSstEmployeePage({ params }: RouteParams) {
  const { companyId } = await params;
  await requireSstProviderEmployeeManageAccessOrDeny(companyId);

  const [departments, positions] = await Promise.all([
    prisma.department.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.position.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return <SstEmployeeForm companyId={companyId} employee={null} departments={departments} positions={positions} />;
}
