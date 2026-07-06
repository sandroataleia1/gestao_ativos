import type { Metadata } from "next";
import { BoxesIcon, MapPinIcon, PackageIcon, ScanBarcodeIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getStockMovements, getStockRows } from "@/lib/stock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockTable } from "./stock-table";
import { StockMovementsTable } from "./stock-movements-table";

export const metadata: Metadata = {
  title: "Estoque — Gestão de Ativos",
};

export default async function StockPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.STOCK_VIEW);
  const canManage = await hasPermission(PERMISSIONS.STOCK_MANAGE);

  const [stock, movements, assets, categories, locations, movementTypes] = await Promise.all([
    getStockRows(companyId),
    getStockMovements(companyId),
    prisma.asset.findMany({
      where: { companyId, active: true },
      select: {
        id: true,
        name: true,
        assetCode: true,
        trackingMode: true,
        defaultUnit: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.assetCategory.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.movementType.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const distinctAssets = new Set(stock.map((row) => row.assetId)).size;
  const distinctLocations = new Set(stock.map((row) => row.locationId)).size;
  const consumableQuantity = stock
    .filter((row) => row.asset.trackingMode === "CONSUMABLE")
    .reduce((sum, row) => sum + row.quantity, 0);
  const individualUnits = stock
    .filter((row) => row.asset.trackingMode === "INDIVIDUAL")
    .reduce((sum, row) => sum + row.quantity, 0);

  const summaryCards = [
    { label: "Ativos em estoque", value: distinctAssets, icon: PackageIcon },
    { label: "Locais com estoque", value: distinctLocations, icon: MapPinIcon },
    { label: "Quantidade (consumíveis)", value: consumableQuantity, icon: BoxesIcon },
    { label: "Unidades individuais", value: individualUnits, icon: ScanBarcodeIcon },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Estoque</h1>
        <p className="text-sm text-muted-foreground">
          Saldo por ativo e local, e histórico de movimentações de entrada.
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
      </div>

      <StockTable
        initialStock={stock}
        categories={categories}
        locations={locations}
        canManage={canManage}
      />

      <StockMovementsTable
        initialMovements={movements.map((m) => ({ ...m, executedAt: m.executedAt.toISOString() }))}
        assets={assets}
        locations={locations}
        movementTypes={movementTypes}
      />
    </div>
  );
}
