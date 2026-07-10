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
import { computeCaBadge, type CaBadge, type CaStatusFilter } from "@/lib/certifications/badge";
import type { AssetSortField } from "@/lib/assets";
import { QrCodeDialog } from "@/components/qr/qr-code-dialog";
import type { AssetRow, LookupOption } from "./types";

const ALL_VALUE = "all";

const CA_BADGE_LABELS: Record<CaBadge, string> = {
  VALID: "CA válido",
  EXPIRED: "CA vencido",
  NONE: "Sem CA",
};

// Chaves em minúsculo — precisam bater com `caStatus` (query param lido em
// app/(app)/assets/page.tsx via CA_STATUS_VALUES/buildCaStatusWhere), não
// com `CaBadge` (usado só pro badge exibido por linha).
const CA_FILTER_LABELS: Record<CaStatusFilter, string> = {
  valid: "Ativos com CA válido",
  expired: "Ativos com CA vencido",
  none: "Ativos sem CA",
};

export function AssetsTable({
  initialAssets,
  total,
  page,
  pageSize,
  sort,
  dir,
  categories,
  manufacturers,
  suppliers,
  statuses,
  conditions,
  canManage,
}: {
  initialAssets: AssetRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: AssetSortField;
  dir: "asc" | "desc";
  categories: LookupOption[];
  manufacturers: LookupOption[];
  suppliers: LookupOption[];
  statuses: LookupOption[];
  conditions: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [deleteTarget, setDeleteTarget] = useState<AssetRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [qrTarget, setQrTarget] = useState<AssetRow | null>(null);

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  const columns = useMemo<ColumnDef<AssetRow>[]>(() => {
    const headerFor = (field: AssetSortField, label: string) => (
      <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
    );

    const base: ColumnDef<AssetRow>[] = [
      {
        accessorKey: "name",
        header: () => headerFor("name", "Nome"),
      },
      {
        accessorKey: "assetCode",
        header: () => headerFor("assetCode", "Código"),
      },
      {
        id: "category",
        accessorFn: (row) => row.category.name,
        header: () => headerFor("category", "Categoria"),
        cell: ({ row }) => row.original.category.name,
      },
      {
        id: "manufacturer",
        accessorFn: (row) => row.manufacturer?.name ?? "",
        header: () => headerFor("manufacturer", "Fabricante"),
        cell: ({ row }) => row.original.manufacturer?.name ?? "—",
      },
      {
        id: "status",
        accessorFn: (row) => row.status.name,
        header: () => headerFor("status", "Status"),
        cell: ({ row }) => {
          const { color, name } = row.original.status;
          return (
            <Badge
              variant="outline"
              style={
                color
                  ? { borderColor: color, color, backgroundColor: `${color}1a` }
                  : undefined
              }
            >
              {name}
            </Badge>
          );
        },
      },
      {
        id: "condition",
        accessorFn: (row) => row.condition.name,
        header: () => headerFor("condition", "Condição"),
        cell: ({ row }) => <Badge variant="secondary">{row.original.condition.name}</Badge>,
      },
      {
        id: "active",
        accessorFn: (row) => (row.active ? 1 : 0),
        header: () => headerFor("active", "Ativo"),
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "default" : "outline"}>
            {row.original.active ? "Ativo" : "Inativo"}
          </Badge>
        ),
      },
      {
        id: "ca",
        accessorFn: (row) => computeCaBadge(row.certifications),
        header: "CA",
        cell: ({ row }) => {
          const badge = computeCaBadge(row.original.certifications);
          return (
            <Badge
              variant={
                badge === "VALID" ? "default" : badge === "EXPIRED" ? "destructive" : "outline"
              }
            >
              {CA_BADGE_LABELS[badge]}
            </Badge>
          );
        },
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
              <DropdownMenuItem render={<Link href={`/assets/${row.original.id}/edit`} />}>
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQrTarget(row.original)}>
                Gerar QR Code
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(row.original)}>
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    });

    return base;
  }, [canManage, sort, dir]);

  const table = useReactTable({
    data: initialAssets,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/assets/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível excluir o ativo.");
      }
      toast.success("Ativo desativado.");
      setDeleteTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsDeleting(false);
    }
  }

  const hasActiveFilters = Boolean(
    searchParams.get("q") ||
      searchParams.get("categoryId") ||
      searchParams.get("statusId") ||
      searchParams.get("conditionId") ||
      searchParams.get("caStatus"),
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DebouncedSearchInput
            placeholder="Buscar por nome, código, categoria, fabricante..."
            className="w-72"
          />

          <Select
            items={{
              [ALL_VALUE]: "Todas as categorias",
              ...Object.fromEntries(categories.map((c) => [c.id, c.name])),
            }}
            value={searchParams.get("categoryId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("categoryId", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todas as categorias</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={{
              [ALL_VALUE]: "Todos os status",
              ...Object.fromEntries(statuses.map((s) => [s.id, s.name])),
            }}
            value={searchParams.get("statusId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("statusId", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos os status</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={{
              [ALL_VALUE]: "Todas as condições",
              ...Object.fromEntries(conditions.map((c) => [c.id, c.name])),
            }}
            value={searchParams.get("conditionId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("conditionId", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Condição" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todas as condições</SelectItem>
              {conditions.map((condition) => (
                <SelectItem key={condition.id} value={condition.id}>
                  {condition.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={{ [ALL_VALUE]: "Todos (CA)", ...CA_FILTER_LABELS }}
            value={searchParams.get("caStatus") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("caStatus", value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="CA" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos (CA)</SelectItem>
              {Object.entries(CA_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canManage ? (
          <Button render={<Link href="/assets/new" />}>
            <PlusIcon />
            Novo ativo
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
                        ? "Nenhum ativo encontrado para os filtros aplicados."
                        : "Nenhum ativo cadastrado ainda."}
                    </p>
                    {canManage && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href="/assets/new" />}>
                        <PlusIcon />
                        Cadastrar o primeiro ativo
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

      <QrCodeDialog
        open={Boolean(qrTarget)}
        onOpenChange={(open) => !open && setQrTarget(null)}
        title="QR Code do ativo"
        description={qrTarget ? `${qrTarget.name} (${qrTarget.assetCode})` : undefined}
        sections={
          qrTarget ? [{ label: "Ativo", resourceKind: "assets", resourceId: qrTarget.id }] : []
        }
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ativo?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} será desativado. O cadastro é preservado (unidades e
              movimentações vinculadas nunca são apagadas) e pode ser reativado depois editando o
              campo &quot;Ativo&quot;.
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
