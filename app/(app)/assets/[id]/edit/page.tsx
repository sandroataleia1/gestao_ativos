import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { assetListInclude, serializeAsset } from "@/lib/assets";
import { AssetForm } from "../../asset-form";
import type { AssetRow } from "../../types";

export const metadata: Metadata = {
  title: "Editar ativo — Gestão de Ativos",
};

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.ASSET_MANAGE);
  const [canManageCategory, canManageManufacturer, canManageSupplier] = await Promise.all([
    hasPermission(PERMISSIONS.CATEGORY_MANAGE),
    hasPermission(PERMISSIONS.MANUFACTURER_MANAGE),
    hasPermission(PERMISSIONS.SUPPLIER_MANAGE),
  ]);

  const [asset, categories, manufacturers, suppliers, statuses, conditions] = await Promise.all([
    prisma.asset.findFirst({
      where: { id, companyId },
      include: assetListInclude,
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.assetCondition.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!asset) notFound();

  return (
    <AssetForm
      asset={serializeAsset(asset) as AssetRow}
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
