import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { AssetForm } from "../asset-form";

export const metadata: Metadata = {
  title: "Novo ativo — Gestão de Ativos",
};

export default async function NewAssetPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.ASSET_MANAGE);
  const [canManageCategory, canManageManufacturer, canManageSupplier] = await Promise.all([
    hasPermission(PERMISSIONS.CATEGORY_MANAGE),
    hasPermission(PERMISSIONS.MANUFACTURER_MANAGE),
    hasPermission(PERMISSIONS.SUPPLIER_MANAGE),
  ]);

  const [categories, manufacturers, suppliers, statuses, conditions] = await Promise.all([
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetCondition.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <AssetForm
      asset={null}
      categories={categories}
      manufacturers={manufacturers}
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.corporateName }))}
      statuses={statuses}
      conditions={conditions}
      canManageCategory={canManageCategory}
      canManageManufacturer={canManageManufacturer}
      canManageSupplier={canManageSupplier}
    />
  );
}
