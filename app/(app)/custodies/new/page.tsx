import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getOrCreateWarehouseLocation, toNumber } from "@/lib/custodies";
import { DeliveryWizard } from "./delivery-wizard";
import { NoActiveEmployeesState } from "./no-active-employees-state";
import type { AssetBalanceMap } from "../types";

export const metadata: Metadata = {
  title: "Nova entrega — Gestão de Ativos",
};

export default async function NewCustodyPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.CUSTODY_MANAGE);

  // Sprint Demo Comercial — Wizard de Nova Entrega, Parte 5: sem
  // colaborador ativo, a operação não pode nem começar — checa isso ANTES
  // de carregar ativos/saldo (evita consulta desnecessária, ver Parte 5
  // "não carregar ativos desnecessariamente").
  const [employees, canManageEmployees] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        document: true,
        phone: true,
        position: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    hasPermission(PERMISSIONS.EMPLOYEE_MANAGE),
  ]);

  if (employees.length === 0) {
    return <NoActiveEmployeesState canManageEmployees={canManageEmployees} />;
  }

  const [assets, availableUnits, company, warehouse] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, assetCode: true, trackingMode: true, defaultUnit: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetUnit.findMany({
      where: { companyId, active: true, currentCustodyId: null },
      select: {
        id: true,
        assetId: true,
        serialNumber: true,
        patrimonyNumber: true,
        condition: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { whatsappApiUrl: true, whatsappApiKey: true, whatsappInstanceName: true },
    }),
    getOrCreateWarehouseLocation(companyId),
  ]);

  const balances = await prisma.stockBalance.findMany({
    where: { companyId, locationId: warehouse.id },
    select: { assetId: true, quantity: true },
  });
  const balanceByAsset: AssetBalanceMap = Object.fromEntries(
    balances.map((balance) => [balance.assetId, toNumber(balance.quantity)]),
  );

  const whatsappConfigured = Boolean(
    company.whatsappApiUrl && company.whatsappApiKey && company.whatsappInstanceName,
  );

  return (
    <DeliveryWizard
      employees={employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        document: employee.document,
        phone: employee.phone,
        position: employee.position?.name ?? null,
        department: employee.department?.name ?? null,
      }))}
      assets={assets}
      availableUnits={availableUnits.map((unit) => ({
        id: unit.id,
        assetId: unit.assetId,
        serialNumber: unit.serialNumber,
        patrimonyNumber: unit.patrimonyNumber,
        condition: unit.condition?.name ?? null,
      }))}
      balanceByAsset={balanceByAsset}
      whatsappConfigured={whatsappConfigured}
    />
  );
}
