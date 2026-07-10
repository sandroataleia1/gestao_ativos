"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServerSortableHeader } from "@/components/ui/data-table-column-header";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TrainingClassSortField } from "@/lib/training-classes";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

const STATUS_BADGE_VARIANT: Record<string, "default" | "outline" | "secondary" | "destructive"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

function formatDateTime(date: Date) {
  return new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type ClassRow = {
  id: string;
  title: string;
  status: string;
  startsAt: Date;
  location: string | null;
  internalInstructor: string | null;
  externalInstructor: string | null;
  maximumParticipants: number | null;
  companyTraining: { id: string; title: string };
  _count: { participants: number };
};

export function SstClassesTable({
  companyId,
  trainingClasses,
  total,
  page,
  pageSize,
  sort,
  dir,
  canOperate,
}: {
  companyId: string;
  trainingClasses: ClassRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: TrainingClassSortField;
  dir: "asc" | "desc";
  canOperate: boolean;
}) {
  const searchParams = useSearchParams();
  const hasActiveFilters = Boolean(searchParams.get("q") || searchParams.get("status"));

  const headerFor = (field: TrainingClassSortField, label: string) => (
    <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DebouncedSearchInput placeholder="Buscar por turma ou local..." className="w-72" />
        {canOperate ? (
          <Button render={<Link href={`/sst/companies/${companyId}/classes/new`} />}>
            <PlusIcon />
            Nova turma
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{headerFor("title", "Turma")}</TableHead>
              <TableHead>Treinamento</TableHead>
              <TableHead>{headerFor("status", "Status")}</TableHead>
              <TableHead>{headerFor("startsAt", "Data")}</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Instrutor</TableHead>
              <TableHead>Participantes</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {trainingClasses.length ? (
              trainingClasses.map((trainingClass) => (
                <TableRow key={trainingClass.id}>
                  <TableCell>{trainingClass.title}</TableCell>
                  <TableCell>{trainingClass.companyTraining.title}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[trainingClass.status]}>
                      {STATUS_LABELS[trainingClass.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(trainingClass.startsAt)}</TableCell>
                  <TableCell>{trainingClass.location ?? "—"}</TableCell>
                  <TableCell>
                    {trainingClass.internalInstructor ?? trainingClass.externalInstructor ?? "—"}
                  </TableCell>
                  <TableCell>
                    {trainingClass._count.participants}
                    {trainingClass.maximumParticipants ? ` / ${trainingClass.maximumParticipants}` : ""}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        render={<Link href={`/sst/companies/${companyId}/classes/${trainingClass.id}`} />}
                      >
                        Ver participantes
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>
                      {hasActiveFilters
                        ? "Nenhuma turma encontrada para os filtros aplicados."
                        : "Nenhuma turma agendada para esta empresa."}
                    </p>
                    {canOperate && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href={`/sst/companies/${companyId}/classes/new`} />}>
                        <PlusIcon />
                        Nova turma
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
