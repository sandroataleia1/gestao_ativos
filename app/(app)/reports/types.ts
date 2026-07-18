import type {
  getAssetsReport,
  getCustodiesReport,
  getExpiringCaReport,
  getStockReport,
  getTrainingsReport,
} from "@/lib/reports";

export type ReportTab = "assets" | "stock" | "custodies" | "ca" | "training";

export type LookupOption = { id: string; name: string };
export type AssetOption = { id: string; name: string; assetCode: string };

export type AssetsReportData = Awaited<ReturnType<typeof getAssetsReport>>;
export type StockReportData = Awaited<ReturnType<typeof getStockReport>>;
export type CustodiesReportData = Awaited<ReturnType<typeof getCustodiesReport>>;
export type ExpiringCaReportData = Awaited<ReturnType<typeof getExpiringCaReport>>;
export type TrainingsReportData = Awaited<ReturnType<typeof getTrainingsReport>>;

export type ReportFilters = {
  categoryId?: string;
  statusId?: string;
  conditionId?: string;
  assetId?: string;
  employeeId?: string;
  locationId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  withinDays?: string;
  companyTrainingId?: string;
  resultStatus?: string;
};

export type ReportLookups = {
  categories: LookupOption[];
  statuses: LookupOption[];
  conditions: LookupOption[];
  locations: LookupOption[];
  employees: LookupOption[];
  assets: AssetOption[];
  companyTrainings: LookupOption[];
};
