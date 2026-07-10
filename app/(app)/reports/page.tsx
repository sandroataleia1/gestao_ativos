import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getAssetsReport,
  getCustodiesReport,
  getExpiringCaReport,
  getStockReport,
} from "@/lib/reports";
import { getCachedReportLookups } from "@/lib/cache";
import { ReportsView } from "./reports-view";
import type { ReportTab } from "./types";

export const metadata: Metadata = {
  title: "Relatórios — Gestão de Ativos",
};

const VALID_TABS: ReportTab[] = ["assets", "stock", "custodies", "ca"];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.REPORT_VIEW);
  const sp = await searchParams;

  const get = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);

  const tabParam = get("tab");
  const tab: ReportTab = (VALID_TABS as string[]).includes(tabParam ?? "")
    ? (tabParam as ReportTab)
    : "assets";

  const filters = {
    categoryId: get("categoryId"),
    statusId: get("statusId"),
    conditionId: get("conditionId"),
    assetId: get("assetId"),
    employeeId: get("employeeId"),
    locationId: get("locationId"),
    status: get("status"),
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    withinDays: get("withinDays"),
  };

  const [{ categories, statuses, conditions, locations }, employees, assets] = await Promise.all([
    getCachedReportLookups(companyId),
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.asset.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, assetCode: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const withinDays = filters.withinDays ? Number(filters.withinDays) : undefined;

  const report =
    tab === "assets"
      ? await getAssetsReport(companyId, filters)
      : tab === "stock"
        ? await getStockReport(companyId, filters)
        : tab === "custodies"
          ? await getCustodiesReport(companyId, {
              ...filters,
              status:
                filters.status === "ACTIVE" || filters.status === "RETURNED"
                  ? filters.status
                  : undefined,
            })
          : await getExpiringCaReport(companyId, {
              ...filters,
              withinDays: withinDays && !Number.isNaN(withinDays) && withinDays > 0 ? withinDays : undefined,
            });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Visão gerencial e exportação de evidências do domínio de ativos.
        </p>
      </div>

      <ReportsView
        tab={tab}
        filters={filters}
        report={report}
        lookups={{ categories, statuses, conditions, locations, employees, assets }}
      />
    </div>
  );
}
