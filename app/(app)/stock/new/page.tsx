import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { StockEntryForm } from "../stock-entry-form";

export const metadata: Metadata = {
  title: "Nova entrada de estoque — Gestão de Ativos",
};

export default async function NewStockEntryPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.STOCK_MANAGE);

  const [assets, statuses, conditions] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, assetCode: true, trackingMode: true, defaultUnit: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetStatus.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetCondition.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return <StockEntryForm assets={assets} statuses={statuses} conditions={conditions} />;
}
