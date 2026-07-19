import type { Metadata } from "next";
import { BoxesIcon, MapPinIcon, PackageIcon, ScanBarcodeIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { STOCK_SORT_FIELDS, getStockRowsPage, getStockMovementsPage } from "@/lib/stock";
import { getCachedStockSummary } from "@/lib/cache";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockTabs, type StockView } from "./stock-tabs";
import type { StockMovementRow, StockRow } from "./types";

export const metadata: Metadata = {
  title: "Estoque — Gestão de Ativos",
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.STOCK_VIEW);
  const canManage = await hasPermission(PERMISSIONS.STOCK_MANAGE);
  const resolvedSearchParams = await searchParams;

  const { page: stockPage, pageSize: stockPageSize } = parsePageParams(resolvedSearchParams, {
    prefix: "stock",
  });
  const stockSearch = parseSearchParam(resolvedSearchParams, "stockQ");
  const { field: stockSort, dir: stockDir } = parseSortParams(
    resolvedSearchParams,
    STOCK_SORT_FIELDS,
    "asset",
    "asc",
    "stock",
  );
  const stockCategoryId = resolvedSearchParams.stockCategoryId as string | undefined;
  const stockLocationId = resolvedSearchParams.stockLocationId as string | undefined;

  const { page: movPage, pageSize: movPageSize } = parsePageParams(resolvedSearchParams, {
    prefix: "mov",
  });
  const movAssetId = resolvedSearchParams.movAssetId as string | undefined;
  const movLocationId = resolvedSearchParams.movLocationId as string | undefined;
  const movTypeId = resolvedSearchParams.movTypeId as string | undefined;

  const view: StockView = resolvedSearchParams.view === "history" ? "history" : "balance";

  const [summary, assets, categories, locations, movementTypes] = await Promise.all([
    getCachedStockSummary(companyId),
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

  // Só a aba ativa busca suas linhas (mesmo padrão de app/(app)/custodies/page.tsx)
  // — nunca carrega saldo e histórico ao mesmo tempo se só um está visível.
  let stock: StockRow[] = [];
  let stockTotal = 0;
  let movements: StockMovementRow[] = [];
  let movTotal = 0;

  if (view === "balance") {
    const result = await getStockRowsPage(companyId, {
      page: stockPage,
      pageSize: stockPageSize,
      search: stockSearch || undefined,
      sort: stockSort,
      dir: stockDir,
      categoryId: stockCategoryId,
      locationId: stockLocationId,
    });
    stock = result.rows;
    stockTotal = result.total;
  } else {
    const result = await getStockMovementsPage(companyId, {
      page: movPage,
      pageSize: movPageSize,
      assetId: movAssetId,
      locationId: movLocationId,
      movementTypeId: movTypeId,
    });
    movements = result.rows.map((m) => ({ ...m, executedAt: m.executedAt.toISOString() }));
    movTotal = result.total;
  }

  const { distinctAssets, distinctLocations, consumableQuantity, individualUnits } = summary;

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

      <StockTabs
        view={view}
        stock={stock}
        stockTotal={stockTotal}
        stockPage={stockPage}
        stockPageSize={stockPageSize}
        stockSort={stockSort}
        stockDir={stockDir}
        movements={movements}
        movTotal={movTotal}
        movPage={movPage}
        movPageSize={movPageSize}
        assets={assets}
        categories={categories}
        locations={locations}
        movementTypes={movementTypes}
        canManage={canManage}
      />
    </div>
  );
}
