"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/ui/data-table-column-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { EmployeeRow } from "./types";

export function EmployeesTable({
  initialEmployees,
  canManage,
}: {
  initialEmployees: EmployeeRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialEmployees;
    return initialEmployees.filter(
      (employee) =>
        employee.name.toLowerCase().includes(q) || employee.document.toLowerCase().includes(q),
    );
  }, [initialEmployees, search]);

  const columns = useMemo<ColumnDef<EmployeeRow>[]>(() => {
    const base: ColumnDef<EmployeeRow>[] = [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} label="Nome" />,
      },
      {
        accessorKey: "document",
        header: ({ column }) => <SortableHeader column={column} label="Documento" />,
      },
      {
        id: "department",
        accessorFn: (row) => row.department?.name ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Departamento" />,
        cell: ({ row }) => row.original.department?.name ?? "—",
      },
      {
        id: "position",
        accessorFn: (row) => row.position?.name ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Cargo" />,
        cell: ({ row }) => row.original.position?.name ?? "—",
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: ({ column }) => <SortableHeader column={column} label="Status" />,
        cell: ({ row }) => (
          <Badge variant={row.original.status === "ACTIVE" ? "default" : "outline"}>
            {row.original.status === "ACTIVE" ? "Ativo" : "Inativo"}
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
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Ações">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={`/employees/${row.original.id}/edit`} />}>
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    });

    return base;
  }, [canManage]);

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/employees/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível excluir o colaborador.");
      }
      toast.success("Colaborador marcado como inativo.");
      setDeleteTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou documento..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
        {canManage ? (
          <Button render={<Link href="/employees/new" />}>
            <PlusIcon />
            Novo colaborador
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
                      {initialEmployees.length
                        ? "Nenhum colaborador encontrado para a busca."
                        : "Nenhum colaborador cadastrado ainda."}
                    </p>
                    {canManage && !initialEmployees.length ? (
                      <Button size="sm" render={<Link href="/employees/new" />}>
                        <PlusIcon />
                        Cadastrar o primeiro colaborador
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} será marcado como inativo. O histórico é preservado e o
              cadastro pode ser reativado depois editando o status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
