import type { Metadata } from "next";
import { AlertTriangleIcon, PackageIcon, TruckIcon, UsersIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { custodyListInclude, getCustodyIndicators, serializeCustody } from "@/lib/custodies";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustodiesTabs } from "./custodies-tabs";
import type { CustodyRow } from "./types";

export const metadata: Metadata = {
  title: "Entregas e Custódia — Gestão de Ativos",
};

function toRow(custody: Awaited<ReturnType<typeof loadCustodies>>[number]): CustodyRow {
  const signatureRequest = custody.signatureRequests[0];
  return {
    ...serializeCustody(custody),
    deliveredAt: custody.deliveredAt.toISOString(),
    expectedReturnAt: custody.expectedReturnAt ? custody.expectedReturnAt.toISOString() : null,
    returnedAt: custody.returnedAt ? custody.returnedAt.toISOString() : null,
    signatureRequest: signatureRequest
      ? {
          status: signatureRequest.status,
          sentAt: signatureRequest.sentAt ? signatureRequest.sentAt.toISOString() : null,
          signedAt: signatureRequest.signedAt ? signatureRequest.signedAt.toISOString() : null,
        }
      : null,
  };
}

function loadCustodies(companyId: string, onlyActive: boolean) {
  return prisma.assetCustody.findMany({
    where: { companyId, ...(onlyActive ? { status: "ACTIVE" as const } : {}) },
    include: custodyListInclude,
    orderBy: { deliveredAt: "desc" },
    take: onlyActive ? undefined : 500,
  });
}

export default async function CustodiesPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.CUSTODY_VIEW);
  const canManage = await hasPermission(PERMISSIONS.CUSTODY_MANAGE);

  const [activeCustodies, historyCustodies, indicators, conditions] = await Promise.all([
    loadCustodies(companyId, true),
    loadCustodies(companyId, false),
    getCustodyIndicators(companyId),
    prisma.assetCondition.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const summaryCards = [
    { label: "Ativos entregues", value: indicators.deliveredCount, icon: TruckIcon },
    { label: "Ativos em estoque", value: indicators.inStockAssetCount, icon: PackageIcon },
    { label: "Devoluções atrasadas", value: indicators.overdueCount, icon: AlertTriangleIcon },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Entregas e Custódia</h1>
        <p className="text-sm text-muted-foreground">
          Ciclo completo entre estoque, entrega ao colaborador e devolução.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Colaboradores com mais ativos
            </CardTitle>
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UsersIcon className="size-4" />
            </span>
          </CardHeader>
          <CardContent>
            {indicators.topEmployees.length ? (
              <ul className="grid gap-1 text-sm">
                {indicators.topEmployees.map((employee) => (
                  <li key={employee.employeeId} className="flex items-center justify-between">
                    <span className="truncate">{employee.name}</span>
                    <span className="font-medium">{employee.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma custódia ativa.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <CustodiesTabs
        initialActive={activeCustodies.map(toRow)}
        initialHistory={historyCustodies.map(toRow)}
        conditions={conditions}
        canManage={canManage}
      />
    </div>
  );
}
