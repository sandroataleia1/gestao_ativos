"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ServerSortableHeader } from "@/components/ui/data-table-column-header";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import type { CompanyTrainingOption, TrainingClassRow } from "./types";

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

function formatDateTime(date: Date | string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function TrainingClassesTable({
  initialTrainingClasses,
  total,
  page,
  pageSize,
  sort,
  dir,
  companyTrainings,
  canManage,
}: {
  initialTrainingClasses: TrainingClassRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: TrainingClassSortField;
  dir: "asc" | "desc";
  companyTrainings: CompanyTrainingOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [cancelTarget, setCancelTarget] = useState<TrainingClassRow | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const columns = useMemo<ColumnDef<TrainingClassRow>[]>(() => {
    const headerFor = (field: TrainingClassSortField, label: string) => (
      <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
    );

    const base: ColumnDef<TrainingClassRow>[] = [
      {
        accessorKey: "title",
        header: () => headerFor("title", "Turma"),
      },
      {
        id: "companyTraining",
        accessorFn: (row) => row.companyTraining.title,
        header: "Treinamento",
        cell: ({ row }) => row.original.companyTraining.title,
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: () => headerFor("status", "Status"),
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGE_VARIANT[row.original.status]}>
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "startsAt",
        accessorFn: (row) => row.startsAt,
        header: () => headerFor("startsAt", "Início"),
        cell: ({ row }) => formatDateTime(row.original.startsAt),
      },
      {
        id: "endsAt",
        accessorFn: (row) => row.endsAt ?? "",
        header: "Término",
        cell: ({ row }) => formatDateTime(row.original.endsAt),
      },
      {
        id: "location",
        accessorFn: (row) => row.location ?? "",
        header: "Local",
        cell: ({ row }) => row.original.location ?? "—",
      },
      {
        id: "participants",
        accessorFn: (row) => row._count.participants,
        header: "Participantes",
        cell: ({ row }) =>
          `${row.original._count.participants}${
            row.original.maximumParticipants ? ` / ${row.original.maximumParticipants}` : ""
          }`,
      },
    ];

    if (!canManage) return base;

    base.push({
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const canCancel = row.original.status === "SCHEDULED" || row.original.status === "IN_PROGRESS";
        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label="Ações">
                          <MoreHorizontalIcon className="size-4" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent>Ações</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={`/trainings/classes/${row.original.id}`} />}>
                  Gerenciar participantes
                </DropdownMenuItem>
                <DropdownMenuItem render={<Link href={`/trainings/classes/${row.original.id}/edit`} />}>
                  Editar
                </DropdownMenuItem>
                {canCancel ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setCancelTarget(row.original)}
                  >
                    Cancelar turma
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    });

    return base;
  }, [canManage, sort, dir]);

  const table = useReactTable({
    data: initialTrainingClasses,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const response = await fetch(`/api/training-classes/${cancelTarget.id}`, {
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
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível cancelar a turma.");
      }
      toast.success("Turma cancelada.");
      setCancelTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsCancelling(false);
    }
  }

  const hasActiveFilters = Boolean(
    searchParams.get("q") || searchParams.get("status") || searchParams.get("companyTrainingId"),
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
            <SelectTrigger size="sm">
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

          <Select
            items={{
              [ALL_VALUE]: "Todos os treinamentos",
              ...Object.fromEntries(companyTrainings.map((t) => [t.id, t.title])),
            }}
            value={searchParams.get("companyTrainingId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("companyTrainingId", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Treinamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos os treinamentos</SelectItem>
              {companyTrainings.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canManage ? (
          <Button render={<Link href="/trainings/classes/new" />}>
            <PlusIcon />
            Nova turma
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>
                      {hasActiveFilters
                        ? "Nenhuma turma encontrada para os filtros aplicados."
                        : "Nenhuma turma cadastrada ainda."}
                    </p>
                    {canManage && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href="/trainings/classes/new" />}>
                        <PlusIcon />
                        Agendar a primeira turma
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
              {cancelTarget?.title} será marcada como cancelada. A turma continua no histórico —
              nada é apagado.
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
