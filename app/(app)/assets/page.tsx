import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { assetListInclude, serializeAsset } from "@/lib/assets";
import { AssetsTable } from "./assets-table";

export const metadata: Metadata = {
  title: "Ativos — Gestão de Ativos",
};

export default async function AssetsPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.ASSET_VIEW);
  const canManage = await hasPermission(PERMISSIONS.ASSET_MANAGE);

  const [assets, categories, manufacturers, suppliers, statuses, conditions] = await Promise.all([
    prisma.asset.findMany({
      where: { companyId },
      include: assetListInclude,
      orderBy: { name: "asc" },
    }),
    prisma.assetCategory.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.manufacturer.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({
      where: { companyId, active: true },
      select: { id: true, corporateName: true },
      orderBy: { corporateName: "asc" },
    }),
    prisma.assetStatus.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetCondition.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ativos</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie o cadastro mestre de ativos da empresa.
        </p>
      </div>

      <AssetsTable
        initialAssets={assets.map(serializeAsset)}
        categories={categories}
        manufacturers={manufacturers}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.corporateName }))}
        statuses={statuses}
        conditions={conditions}
        canManage={canManage}
      />
    </div>
  );
}
