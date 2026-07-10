import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  PlayCircleIcon,
  XCircleIcon,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getTrainingClassesDashboardSummary,
  getTrainingClassesPage,
  TRAINING_CLASS_SORT_FIELDS,
} from "@/lib/training-classes";
import { TRAINING_CLASS_STATUS_VALUES } from "@/lib/validations/training-class";
import { parsePageParams, parseSearchParam, parseSortParams, type SearchParamsInput } from "@/lib/pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrainingClassesTable } from "./training-classes-table";

export const metadata: Metadata = {
  title: "Turmas de Treinamento — Gestão de Ativos",
};

function formatDateTime(date: Date) {
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof CalendarClockIcon;
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

export default async function TrainingClassesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.TRAINING_VIEW);
  const canManage = await hasPermission(PERMISSIONS.TRAINING_MANAGE);
  const resolvedSearchParams = await searchParams;

  const { page, pageSize } = parsePageParams(resolvedSearchParams);
  const search = parseSearchParam(resolvedSearchParams);
  const { field: sort, dir } = parseSortParams(resolvedSearchParams, TRAINING_CLASS_SORT_FIELDS, "startsAt");

  const statusParam = resolvedSearchParams.status as string | undefined;
  const status = (TRAINING_CLASS_STATUS_VALUES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof TRAINING_CLASS_STATUS_VALUES)[number])
    : undefined;

  const companyTrainingId = resolvedSearchParams.companyTrainingId as string | undefined;

  const [summary, { rows: trainingClasses, total }, companyTrainings] = await Promise.all([
    getTrainingClassesDashboardSummary(companyId),
    getTrainingClassesPage(companyId, {
      page,
      pageSize,
      search: search || undefined,
      status,
      companyTrainingId,
      sort,
      dir,
    }),
    prisma.companyTraining.findMany({
      where: { companyId, active: true },
      select: { id: true, title: true, trainingType: true, category: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Turmas de Treinamento</h1>
        <p className="text-sm text-muted-foreground">
          Agende e acompanhe as turmas dos treinamentos da empresa.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Agendadas" value={summary.scheduled} icon={CalendarIcon} />
        <SummaryCard label="Em andamento" value={summary.inProgress} icon={PlayCircleIcon} />
        <SummaryCard label="Concluídas" value={summary.completed} icon={CheckCircle2Icon} />
        <SummaryCard label="Canceladas" value={summary.cancelled} icon={XCircleIcon} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarClockIcon className="size-4" />
            Próximas turmas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.upcoming.length ? (
            <ul className="grid gap-2 text-sm">
              {summary.upcoming.map((trainingClass) => (
                <li key={trainingClass.id} className="flex items-center justify-between gap-4">
                  <Link href={`/trainings/classes/${trainingClass.id}/edit`} className="truncate hover:underline">
                    {trainingClass.title}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">
                    {formatDateTime(trainingClass.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma turma agendada.</p>
          )}
        </CardContent>
      </Card>

      <TrainingClassesTable
        initialTrainingClasses={trainingClasses}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        companyTrainings={companyTrainings}
        canManage={canManage}
      />
    </div>
  );
}
