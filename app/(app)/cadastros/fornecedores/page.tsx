import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { hasPermission, requireCompanyOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getSuppliersPage } from "@/lib/cadastros";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { LookupManager } from "../lookup-manager";
import { SUPPLIER_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Fornecedores — Gestão de Ativos",
};

const SORT_FIELDS = ["corporateName", "tradeName", "document", "phone"] as const;

export default async function FornecedoresPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requireCompanyOrDeny();
  const canManage = await hasPermission(PERMISSIONS.SUPPLIER_MANAGE);
  if (!canManage) forbidden();
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, SORT_FIELDS, "corporateName");

  const { rows: suppliers, total } = await getSuppliersPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fornecedores</h1>
        <p className="text-sm text-muted-foreground">{SUPPLIER_CONFIG.description}</p>
      </div>

      <LookupManager
        config={SUPPLIER_CONFIG}
        initialRows={suppliers as LookupRow[]}
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
