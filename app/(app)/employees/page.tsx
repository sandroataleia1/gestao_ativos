import type { Metadata } from "next";

import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { EMPLOYEE_SORT_FIELDS, getEmployeesPage } from "@/lib/employees";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = {
  title: "Colaboradores — Gestão de Ativos",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.EMPLOYEE_VIEW);
  const canManage = await hasPermission(PERMISSIONS.EMPLOYEE_MANAGE);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, EMPLOYEE_SORT_FIELDS, "name");

  const { rows: employees, total } = await getEmployeesPage(companyId, {
    page,
    pageSize,
    search: search || undefined,
    sort,
    dir,
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Colaboradores</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os colaboradores da empresa.
        </p>
      </div>

      <EmployeesTable
        initialEmployees={employees}
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
