"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { AssetOption, LookupOption, StockMovementRow } from "./types";

const ALL_VALUE = "all";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function StockMovementsTable({
  initialMovements,
  total,
  page,
  pageSize,
  assets,
  locations,
  movementTypes,
  canManage,
}: {
  initialMovements: StockMovementRow[];
  total: number;
  page: number;
  pageSize: number;
  assets: AssetOption[];
  locations: LookupOption[];
  movementTypes: LookupOption[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("movPage");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasActiveFilters = Boolean(
    searchParams.get("movAssetId") || searchParams.get("movTypeId") || searchParams.get("movLocationId"),
  );

  const columns = useMemo<ColumnDef<StockMovementRow>[]>(
    () => [
      {
        id: "executedAt",
        accessorFn: (row) => row.executedAt,
        header: "Data",
        cell: ({ row }) => formatDateTime(row.original.executedAt),
      },
      {
        id: "asset",
        accessorFn: (row) => row.asset.name,
        header: "Ativo",
        cell: ({ row }) => row.original.asset.name,
      },
      {
        id: "detail",
        accessorFn: (row) => row.assetUnit?.serialNumber ?? row.assetUnit?.patrimonyNumber ?? "",
        header: "Detalhe",
        cell: ({ row }) =>
          row.original.assetUnit?.serialNumber ??
          row.original.assetUnit?.patrimonyNumber ??
          "—",
      },
      {
        id: "type",
        accessorFn: (row) => row.movementType.name,
        header: "Tipo",
        cell: ({ row }) => <Badge variant="outline">{row.original.movementType.name}</Badge>,
      },
      {
        id: "quantity",
        accessorFn: (row) => row.quantity,
        header: "Quantidade",
        cell: ({ row }) => row.original.quantity,
      },
      {
        id: "destination",
        accessorFn: (row) => row.destinationLocation?.name ?? "",
        header: "Destino",
        cell: ({ row }) => row.original.destinationLocation?.name ?? "—",
      },
    ],
    [],
  );

  const table = useReactTable({
    data: initialMovements,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Entradas registradas para ativos por quantidade e por série/patrimônio.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={{
            [ALL_VALUE]: "Todos os ativos",
            ...Object.fromEntries(assets.map((a) => [a.id, a.name])),
          }}
          value={searchParams.get("movAssetId") ?? ALL_VALUE}
          onValueChange={(value) => applyFilter("movAssetId", value as string)}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Ativo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os ativos</SelectItem>
            {assets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={{
            [ALL_VALUE]: "Todos os tipos",
            ...Object.fromEntries(movementTypes.map((t) => [t.id, t.name])),
          }}
          value={searchParams.get("movTypeId") ?? ALL_VALUE}
          onValueChange={(value) => applyFilter("movTypeId", value as string)}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os tipos</SelectItem>
            {movementTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={{
            [ALL_VALUE]: "Todos os locais",
            ...Object.fromEntries(locations.map((l) => [l.id, l.name])),
          }}
          value={searchParams.get("movLocationId") ?? ALL_VALUE}
          onValueChange={(value) => applyFilter("movLocationId", value as string)}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Local" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os locais</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>
                      {hasActiveFilters
                        ? "Nenhuma movimentação encontrada para os filtros aplicados."
                        : "Nenhuma movimentação registrada ainda."}
                    </p>
                    {canManage && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href="/stock/new" />}>
                        <PlusIcon />
                        Lançar a primeira entrada
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar page={page} pageSize={pageSize} total={total} paramKey="movPage" />
    </div>
  );
}
