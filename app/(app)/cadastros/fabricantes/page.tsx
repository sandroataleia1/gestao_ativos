import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { hasPermission, requireCompanyOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getManufacturersPage } from "@/lib/cadastros";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { LookupManager } from "../lookup-manager";
import { MANUFACTURER_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Fabricantes — Gestão de Ativos",
};

const SORT_FIELDS = ["name", "document", "phone", "email"] as const;

export default async function FabricantesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requireCompanyOrDeny();
  const canManage = await hasPermission(PERMISSIONS.MANUFACTURER_MANAGE);
  if (!canManage) forbidden();
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, SORT_FIELDS, "name");

  const { rows: manufacturers, total } = await getManufacturersPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fabricantes</h1>
        <p className="text-sm text-muted-foreground">{MANUFACTURER_CONFIG.description}</p>
      </div>

      <LookupManager
        config={MANUFACTURER_CONFIG}
        initialRows={manufacturers as LookupRow[]}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        canManage={canManage}
      />
    </div>
  );
}
