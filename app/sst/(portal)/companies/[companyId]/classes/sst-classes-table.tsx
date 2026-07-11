"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServerSortableHeader } from "@/components/ui/data-table-column-header";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TrainingClassSortField } from "@/lib/training-classes";

const ALL_VALUE = "all";

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
  companyTrainingId: string;
  title: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  internalInstructor: string | null;
  externalInstructor: string | null;
  maximumParticipants: number | null;
  notes: string | null;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cancelTarget, setCancelTarget] = useState<ClassRow | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const hasActiveFilters = Boolean(searchParams.get("q") || searchParams.get("status"));

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`?${params.toString()}`);
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const response = await fetch(`/api/sst/companies/${companyId}/classes/${cancelTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyTrainingId: cancelTarget.companyTrainingId,
          title: cancelTarget.title,
          startsAt: cancelTarget.startsAt,
          endsAt: cancelTarget.endsAt,
          location: cancelTarget.location,
          internalInstructor: cancelTarget.internalInstructor,
          externalInstructor: cancelTarget.externalInstructor,
          maximumParticipants: cancelTarget.maximumParticipants,
          notes: cancelTarget.notes,
          status: "CANCELLED",
        }),
      });
      if (!response.ok) {
        throw new Error("Não foi possível cancelar a turma.");
      }
      toast.success("Turma cancelada.");
      setCancelTarget(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível cancelar a turma. Tente novamente.");
    } finally {
      setIsCancelling(false);
    }
  }

  const headerFor = (field: TrainingClassSortField, label: string) => (
    <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DebouncedSearchInput placeholder="Buscar por turma ou local..." className="w-72" />
          <Select
            items={{ [ALL_VALUE]: "Todos os status", ...STATUS_LABELS }}
            value={searchParams.get("status") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("status", value as string)}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos os status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              trainingClasses.map((trainingClass) => {
                const isCancelled = trainingClass.status === "CANCELLED";
                const canCancel = trainingClass.status === "SCHEDULED" || trainingClass.status === "IN_PROGRESS";
                return (
                  <TableRow key={trainingClass.id} className={isCancelled ? "opacity-60" : undefined}>
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
                        {canOperate ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon-sm" aria-label="Ações">
                                  <MoreHorizontalIcon className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem render={<Link href={`/sst/companies/${companyId}/classes/${trainingClass.id}`} />}>
                                Ver participantes
                              </DropdownMenuItem>
                              {canCancel ? (
                                <DropdownMenuItem variant="destructive" onClick={() => setCancelTarget(trainingClass)}>
                                  Cancelar turma
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            render={<Link href={`/sst/companies/${companyId}/classes/${trainingClass.id}`} />}
                          >
                            Ver participantes
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
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

      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar turma?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.title} será marcada como cancelada. A turma continua no histórico — nada é apagado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              disabled={isCancelling}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isCancelling ? "Cancelando..." : "Cancelar turma"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
