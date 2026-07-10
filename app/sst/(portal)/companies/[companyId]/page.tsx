import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, CalendarDaysIcon, CheckCircle2Icon, UsersIcon } from "lucide-react";

import { requireSstProviderCompanyAccessOrDeny } from "@/lib/sst-auth";
import {
  getCompanyTrainingMetrics,
  getCriticalTrainingsForCompany,
  getEmployeesWithPendingTraining,
  getUpcomingClassesForCompany,
} from "@/lib/sst-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplianceStatusBadge } from "@/app/sst/compliance-badge";

export const metadata: Metadata = {
  title: "Empresa — Portal Consultoria SST",
};

const ACCESS_LEVEL_LABEL: Record<string, string> = {
  VIEW: "Visualização",
  OPERATION: "Operação",
  ADMINISTRATION: "Administração",
};

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatDateTime(date: Date) {
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type RouteParams = { params: Promise<{ companyId: string }> };

export default async function SstCompanySummaryPage({ params }: RouteParams) {
  const { companyId } = await params;
  const { link } = await requireSstProviderCompanyAccessOrDeny(companyId);

  const [metrics, upcomingClasses, criticalTrainings, employeesWithPendingTraining] = await Promise.all([
    getCompanyTrainingMetrics(companyId),
    getUpcomingClassesForCompany(companyId),
    getCriticalTrainingsForCompany(companyId),
    getEmployeesWithPendingTraining(companyId),
  ]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{metrics.companyName}</h1>
            <ComplianceStatusBadge status={metrics.complianceStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            Vínculo: {ACCESS_LEVEL_LABEL[link.accessLevel] ?? link.accessLevel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href={`/sst/companies/${companyId}/trainings`} />}>
            Ver treinamentos
          </Button>
          <Button variant="outline" render={<Link href={`/sst/companies/${companyId}/classes`} />}>
            Ver turmas
          </Button>
          <Button variant="outline" render={<Link href={`/sst/companies/${companyId}/employees`} />}>
            Ver colaboradores
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Colaboradores ativos" value={metrics.activeEmployeeCount} />
        <StatCard label="Treinamentos ativos" value={metrics.activeTrainingCount} />
        <StatCard label="Turmas agendadas" value={metrics.scheduledClassCount} />
        <StatCard label="Treinamentos vencidos" value={metrics.expiredCount} />
        <StatCard label="Vencendo em 30 dias" value={metrics.expiringSoonCount} />
        <StatCard label="Sem treinamento obrigatório" value={metrics.missingMandatoryCount} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CalendarDaysIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Próximas turmas</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingClasses.length ? (
              <ul className="grid gap-2 text-sm">
                {upcomingClasses.map((trainingClass) => (
                  <li key={trainingClass.id} className="grid gap-0.5">
                    <span className="font-medium">{trainingClass.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {trainingClass.companyTraining.title} · {formatDateTime(trainingClass.startsAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma turma agendada.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangleIcon className="size-4 text-destructive" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Treinamentos críticos</CardTitle>
          </CardHeader>
          <CardContent>
            {criticalTrainings.length ? (
              <ul className="grid gap-2 text-sm">
                {criticalTrainings.map((training) => (
                  <li key={training.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {training.title}
                      {training.mandatory ? (
                        <Badge variant="outline" className="text-xs">
                          Obrigatório
                        </Badge>
                      ) : null}
                    </span>
                    <Badge variant="destructive">{training.expiredCount} vencido(s)</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                <span>Nenhum treinamento vencido.</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <UsersIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Colaboradores com pendência</CardTitle>
          </CardHeader>
          <CardContent>
            {employeesWithPendingTraining.length ? (
              <ul className="grid gap-2 text-sm">
                {employeesWithPendingTraining.map((employee) => (
                  <li key={employee.id} className="flex items-center justify-between gap-2">
                    <span>{employee.name}</span>
                    <Badge variant="outline">{employee.missingMandatoryCount} pendência(s)</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                <span>Nenhuma pendência.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
