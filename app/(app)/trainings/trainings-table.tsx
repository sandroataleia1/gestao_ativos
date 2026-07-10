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
import type { TrainingSortField } from "@/lib/trainings";
import type { CompanyTrainingRow } from "./types";

const ALL_VALUE = "all";

const TRAINING_TYPE_LABELS: Record<string, string> = {
  LEGAL: "Legal",
  CORPORATE: "Corporativo",
};

export function TrainingsTable({
  initialTrainings,
  total,
  page,
  pageSize,
  sort,
  dir,
  canManage,
}: {
  initialTrainings: CompanyTrainingRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: TrainingSortField;
  dir: "asc" | "desc";
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deleteTarget, setDeleteTarget] = useState<CompanyTrainingRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const columns = useMemo<ColumnDef<CompanyTrainingRow>[]>(() => {
    const headerFor = (field: TrainingSortField, label: string) => (
      <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
    );

    const base: ColumnDef<CompanyTrainingRow>[] = [
      {
        accessorKey: "title",
        header: () => headerFor("title", "Título"),
      },
      {
        id: "category",
        accessorFn: (row) => row.category ?? "",
        header: () => headerFor("category", "Categoria"),
        cell: ({ row }) => row.original.category ?? "—",
      },
      {
        id: "trainingType",
        accessorFn: (row) => row.trainingType,
        header: () => headerFor("trainingType", "Tipo"),
        cell: ({ row }) => (
          <Badge variant="outline">{TRAINING_TYPE_LABELS[row.original.trainingType]}</Badge>
        ),
      },
      {
        id: "nrReference",
        accessorFn: (row) => row.nrReference ?? "",
        header: "NR",
        cell: ({ row }) => row.original.nrReference ?? "—",
      },
      {
        id: "validityMonths",
        accessorFn: (row) => row.validityMonths ?? "",
        header: "Validade",
        cell: ({ row }) =>
          row.original.validityMonths ? `${row.original.validityMonths} meses` : "—",
      },
      {
        id: "workloadHours",
        accessorFn: (row) => row.workloadHours ?? "",
        header: "Carga horária",
        cell: ({ row }) => (row.original.workloadHours ? `${row.original.workloadHours}h` : "—"),
      },
      {
        id: "managementMode",
        accessorFn: (row) => row.managementMode,
        header: "Gestão",
        cell: ({ row }) => {
          if (row.original.managementMode !== "EXTERNAL_PROVIDER") {
            return <Badge variant="outline">Interno</Badge>;
          }
          const provider = row.original.managedByProvider;
          const linkStatus = provider?.companyLinks[0]?.status;
          const isUnauthorized = !linkStatus || linkStatus !== "ACTIVE";
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">Consultoria SST</Badge>
              {provider ? <span className="text-xs text-muted-foreground">{provider.name}</span> : null}
              {isUnauthorized ? (
                <Badge variant="destructive">Prestador sem autorização ativa</Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "mandatory",
        accessorFn: (row) => (row.mandatory ? 1 : 0),
        header: () => headerFor("mandatory", "Obrigatório"),
        cell: ({ row }) => (
          <Badge variant={row.original.mandatory ? "default" : "outline"}>
            {row.original.mandatory ? "Obrigatório" : "Opcional"}
          </Badge>
        ),
      },
      {
        id: "active",
        accessorFn: (row) => (row.active ? 1 : 0),
        header: () => headerFor("active", "Status"),
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "default" : "outline"}>
            {row.original.active ? "Ativo" : "Inativo"}
          </Badge>
        ),
      },
    ];

    if (!canManage) return base;

    base.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
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
              <DropdownMenuItem render={<Link href={`/trainings/${row.original.id}/edit`} />}>
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                Desativar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    });

    return base;
  }, [canManage, sort, dir]);

  const table = useReactTable({
    data: initialTrainings,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/trainings/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível desativar o treinamento.");
      }
      toast.success("Treinamento desativado.");
      setDeleteTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsDeleting(false);
    }
  }

  const hasActiveFilters = Boolean(
    searchParams.get("q") || searchParams.get("trainingType") || searchParams.get("mandatory") || searchParams.get("active"),
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DebouncedSearchInput
            placeholder="Buscar por título, categoria ou NR..."
            className="w-72"
          />

          <Select
            items={{ [ALL_VALUE]: "Todos os tipos", ...TRAINING_TYPE_LABELS }}
            value={searchParams.get("trainingType") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("trainingType", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos os tipos</SelectItem>
              {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={{ [ALL_VALUE]: "Obrigatório e opcional", true: "Obrigatório", false: "Opcional" }}
            value={searchParams.get("mandatory") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("mandatory", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Obrigatório" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Obrigatório e opcional</SelectItem>
              <SelectItem value="true">Obrigatório</SelectItem>
              <SelectItem value="false">Opcional</SelectItem>
            </SelectContent>
          </Select>

          <Select
            items={{ [ALL_VALUE]: "Ativos e inativos", true: "Ativo", false: "Inativo" }}
            value={searchParams.get("active") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("active", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Ativos e inativos</SelectItem>
              <SelectItem value="true">Ativo</SelectItem>
              <SelectItem value="false">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {canManage ? (
          <Button render={<Link href="/trainings/new" />}>
            <PlusIcon />
            Novo treinamento
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
                        ? "Nenhum treinamento encontrado para os filtros aplicados."
                        : "Nenhum treinamento cadastrado ainda."}
                    </p>
                    {canManage && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href="/trainings/new" />}>
                        <PlusIcon />
                        Cadastrar o primeiro treinamento
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

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar treinamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title} será desativado. O cadastro é preservado e pode ser reativado
              depois editando o status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting ? "Desativando..." : "Desativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
