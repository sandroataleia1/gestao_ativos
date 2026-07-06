import type { Metadata } from "next";

import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getAlerts } from "@/lib/alerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertsView } from "./alerts-view";

export const metadata: Metadata = {
  title: "Alertas — Gestão de Ativos",
};

export default async function AlertsPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.ALERT_VIEW);
  const { alerts, summary } = await getAlerts(companyId);

  const summaryCards = [
    { label: "Total de alertas", value: summary.total },
    { label: "Críticos", value: summary.critical },
    { label: "Atenção", value: summary.warning },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Alertas</h1>
        <p className="text-sm text-muted-foreground">
          CA vencido ou próximo do vencimento, devoluções atrasadas e estoque abaixo do mínimo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {summaryCards.map(({ label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertsView initialAlerts={alerts} />
    </div>
  );
}
