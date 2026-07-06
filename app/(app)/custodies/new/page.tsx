import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { DeliverForm } from "../deliver-form";

export const metadata: Metadata = {
  title: "Nova entrega — Gestão de Ativos",
};

export default async function NewCustodyPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.CUSTODY_MANAGE);

  const [employees, assets, availableUnits] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, name: true, document: true, phone: true },
      orderBy: { name: "asc" },
    }),
    prisma.asset.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, assetCode: true, trackingMode: true, defaultUnit: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetUnit.findMany({
      where: { companyId, active: true, currentCustodyId: null },
      select: { id: true, assetId: true, serialNumber: true, patrimonyNumber: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return <DeliverForm employees={employees} assets={assets} availableUnits={availableUnits} />;
}
