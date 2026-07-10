import { Badge } from "@/components/ui/badge";
import type { SstComplianceStatus } from "@/lib/sst-dashboard";

const COMPLIANCE_STATUS_LABEL: Record<SstComplianceStatus, string> = {
  EM_DIA: "Em dia",
  ATENCAO: "Atenção",
  CRITICA: "Crítica",
};

const COMPLIANCE_STATUS_CLASSNAME: Record<SstComplianceStatus, string> = {
  EM_DIA: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  ATENCAO: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  CRITICA: "",
};

export function ComplianceStatusBadge({ status }: { status: SstComplianceStatus }) {
  if (status === "CRITICA") {
    return <Badge variant="destructive">{COMPLIANCE_STATUS_LABEL[status]}</Badge>;
  }
  return (
    <Badge variant="outline" className={COMPLIANCE_STATUS_CLASSNAME[status]}>
      {COMPLIANCE_STATUS_LABEL[status]}
    </Badge>
  );
}
