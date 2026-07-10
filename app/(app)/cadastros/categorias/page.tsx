import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { hasPermission, requireCompanyOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getCategoriesPage } from "@/lib/cadastros";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { LookupManager } from "../lookup-manager";
import { CATEGORY_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Categorias — Gestão de Ativos",
};

const SORT_FIELDS = ["name", "description", "color"] as const;

export default async function CategoriasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requireCompanyOrDeny();
  const canManage = await hasPermission(PERMISSIONS.CATEGORY_MANAGE);
  if (!canManage) forbidden();
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, SORT_FIELDS, "name");

  const { rows: categories, total } = await getCategoriesPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Categorias</h1>
        <p className="text-sm text-muted-foreground">{CATEGORY_CONFIG.description}</p>
      </div>

      <LookupManager
        config={CATEGORY_CONFIG}
        initialRows={categories as LookupRow[]}
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
