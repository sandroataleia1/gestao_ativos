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
import { computeCaBadge, type CaBadge } from "@/lib/certifications/badge";
import { QrCodeDialog } from "@/components/qr/qr-code-dialog";
import type { AssetRow, LookupOption } from "./types";

const ALL_VALUE = "all";

const CA_BADGE_LABELS: Record<CaBadge, string> = {
  VALID: "CA válido",
  EXPIRED: "CA vencido",
  NONE: "Sem CA",
};

const CA_FILTER_LABELS: Record<CaBadge, string> = {
  VALID: "Ativos com CA válido",
  EXPIRED: "Ativos com CA vencido",
  NONE: "Ativos sem CA",
};

export function AssetsTable({
  initialAssets,
  categories,
  manufacturers,
  suppliers,
  statuses,
  conditions,
  canManage,
}: {
  initialAssets: AssetRow[];
  categories: LookupOption[];
  manufacturers: LookupOption[];
  suppliers: LookupOption[];
  statuses: LookupOption[];
  conditions: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_VALUE);
  const [statusFilter, setStatusFilter] = useState(ALL_VALUE);
  const [conditionFilter, setConditionFilter] = useState(ALL_VALUE);
  const [caFilter, setCaFilter] = useState(ALL_VALUE);
  const [deleteTarget, setDeleteTarget] = useState<AssetRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [qrTarget, setQrTarget] = useState<AssetRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialAssets.filter((asset) => {
      if (categoryFilter !== ALL_VALUE && asset.categoryId !== categoryFilter) return false;
      if (statusFilter !== ALL_VALUE && asset.statusId !== statusFilter) return false;
      if (conditionFilter !== ALL_VALUE && asset.conditionId !== conditionFilter) return false;
      if (caFilter !== ALL_VALUE && computeCaBadge(asset.certifications) !== caFilter) return false;
      if (!q) return true;
      return (
        asset.name.toLowerCase().includes(q) ||
        asset.assetCode.toLowerCase().includes(q) ||
        asset.category.name.toLowerCase().includes(q) ||
        (asset.manufacturer?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [initialAssets, search, categoryFilter, statusFilter, conditionFilter, caFilter]);

  const columns = useMemo<ColumnDef<AssetRow>[]>(() => {
    const base: ColumnDef<AssetRow>[] = [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column} label="Nome" />,
      },
      {
        accessorKey: "assetCode",
        header: ({ column }) => <SortableHeader column={column} label="Código" />,
      },
      {
        id: "category",
        accessorFn: (row) => row.category.name,
        header: ({ column }) => <SortableHeader column={column} label="Categoria" />,
        cell: ({ row }) => row.original.category.name,
      },
      {
        id: "manufacturer",
        accessorFn: (row) => row.manufacturer?.name ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Fabricante" />,
        cell: ({ row }) => row.original.manufacturer?.name ?? "—",
      },
      {
        id: "status",
        accessorFn: (row) => row.status.name,
        header: ({ column }) => <SortableHeader column={column} label="Status" />,
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
        header: ({ column }) => <SortableHeader column={column} label="Condição" />,
        cell: ({ row }) => <Badge variant="secondary">{row.original.condition.name}</Badge>,
      },
      {
        id: "active",
        accessorFn: (row) => (row.active ? 1 : 0),
        header: ({ column }) => <SortableHeader column={column} label="Ativo" />,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? "default" : "outline"}>
            {row.original.active ? "Ativo" : "Inativo"}
          </Badge>
        ),
      },
      {
        id: "ca",
        accessorFn: (row) => computeCaBadge(row.certifications),
        header: ({ column }) => <SortableHeader column={column} label="CA" />,
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
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Ações">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              }
            />
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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, código, categoria, fabricante..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-72 pl-8"
            />
          </div>

          <Select
            items={{
              [ALL_VALUE]: "Todas as categorias",
              ...Object.fromEntries(categories.map((c) => [c.id, c.name])),
            }}
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value ?? ALL_VALUE)}
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
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value ?? ALL_VALUE)}
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
            value={conditionFilter}
            onValueChange={(value) => setConditionFilter(value ?? ALL_VALUE)}
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
            value={caFilter}
            onValueChange={(value) => setCaFilter(value ?? ALL_VALUE)}
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
                      {initialAssets.length
                        ? "Nenhum ativo encontrado para os filtros aplicados."
                        : "Nenhum ativo cadastrado ainda."}
                    </p>
                    {canManage && !initialAssets.length ? (
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
