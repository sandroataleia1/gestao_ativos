import type { Metadata } from "next";

import { requireSstProviderCompanyAccessOrDeny } from "@/lib/sst-auth";
import { getSstCompanyEmployeesPage } from "@/lib/sst-employees";
import { parsePageParams, parseSearchParam, type SearchParamsInput } from "@/lib/pagination";
import { SstEmployeesTable } from "./sst-employees-table";

export const metadata: Metadata = {
  title: "Colaboradores — Portal Consultoria SST",
};

type RouteParams = { params: Promise<{ companyId: string }>; searchParams: Promise<SearchParamsInput> };

export default async function SstEmployeesPage({ params, searchParams }: RouteParams) {
  const { companyId } = await params;
  await requireSstProviderCompanyAccessOrDeny(companyId);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams, { defaultPageSize: 20 });
  const search = parseSearchParam(resolvedSearchParams);

  const { rows: employees, total } = await getSstCompanyEmployeesPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Colaboradores</h1>
        <p className="text-sm text-muted-foreground">Os colaboradores são administrados pela empresa.</p>
      </div>

      <SstEmployeesTable companyId={companyId} employees={employees} total={total} page={page} pageSize={pageSize} />
    </div>
  );
}
