import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { ASSET_SORT_FIELDS, getAssetsPage } from "@/lib/assets";
import { CA_STATUS_VALUES } from "@/lib/certifications";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { AssetsTable } from "./assets-table";

export const metadata: Metadata = {
  title: "Ativos — Gestão de Ativos",
};

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.ASSET_VIEW);
  const canManage = await hasPermission(PERMISSIONS.ASSET_MANAGE);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, ASSET_SORT_FIELDS, "name");
  const categoryId = resolvedSearchParams.categoryId as string | undefined;
  const statusId = resolvedSearchParams.statusId as string | undefined;
  const conditionId = resolvedSearchParams.conditionId as string | undefined;
  const caStatusParam = resolvedSearchParams.caStatus as string | undefined;
  const caStatus = CA_STATUS_VALUES.find((value) => value === caStatusParam);

  const [{ rows: assets, total }, categories, manufacturers, suppliers, statuses, conditions] =
    await Promise.all([
      getAssetsPage(companyId, {
        page,
        pageSize,
        search: search || undefined,
        categoryId,
        statusId,
        conditionId,
        caStatus,
        sort,
        dir,
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
        initialAssets={assets}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
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
