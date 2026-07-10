import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangleIcon,
  BuildingIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  GaugeIcon,
  GraduationCapIcon,
  UsersIcon,
} from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { getProviderDashboardSummary } from "@/lib/sst-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplianceStatusBadge } from "@/app/sst/compliance-badge";

export const metadata: Metadata = {
  title: "Dashboard — Portal Consultoria SST",
};

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof BuildingIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function SstDashboardPage() {
  const { providerId } = await requireSstAuthOrDeny();
  const summary = await getProviderDashboardSummary(providerId);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral da conformidade de treinamento das empresas atendidas pela sua consultoria.
        </p>
      </div>

      {summary.companyCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BuildingIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">Nenhuma empresa autorizada ainda.</p>
            <p className="text-sm text-muted-foreground">
              Peça para uma empresa autorizar sua consultoria em Configurações → Prestadores SST.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Empresas atendidas" value={summary.companyCount} icon={BuildingIcon} />
            <SummaryCard label="Colaboradores ativos" value={summary.activeEmployeeCount} icon={UsersIcon} />
            <SummaryCard label="Treinamentos ativos" value={summary.activeTrainingCount} icon={GraduationCapIcon} />
            <SummaryCard label="Índice de conformidade SST" value={`${summary.averageComplianceScore}%`} icon={GaugeIcon} />
            <SummaryCard label="Treinamentos vencidos" value={summary.expiredCount} icon={AlertTriangleIcon} />
            <SummaryCard label="Vencendo em 30 dias" value={summary.expiringSoonCount} icon={ClockIcon} />
            <SummaryCard label="Turmas hoje" value={summary.classesTodayCount} icon={CalendarCheckIcon} />
            <SummaryCard label="Turmas esta semana" value={summary.classesThisWeekCount} icon={CalendarDaysIcon} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Empresas que precisam de atenção</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.companiesNeedingAttention.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                  <span>Tudo certo. Nenhuma empresa crítica no momento.</span>
                </div>
              ) : (
                <ul className="grid gap-3">
                  {summary.companiesNeedingAttention.map((company) => (
                    <li
                      key={company.companyId}
                      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{company.companyName}</span>
                          <ComplianceStatusBadge status={company.complianceStatus} />
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{company.activeEmployeeCount} colaborador(es) ativo(s)</span>
                          <span>{company.expiredCount} treinamento(s) vencido(s)</span>
                          <span>{company.expiringSoonCount} vencendo em 30 dias</span>
                          <span>{company.missingMandatoryCount} sem treinamento obrigatório</span>
                          <span>Índice: {company.complianceScore}%</span>
                        </div>
                      </div>
                      <Button size="sm" render={<Link href={`/sst/companies/${company.companyId}`} />}>
                        Entrar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
