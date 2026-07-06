"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

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
import type { AssetOption, LookupOption, StockMovementRow } from "./types";

const ALL_VALUE = "all";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function StockMovementsTable({
  initialMovements,
  assets,
  locations,
  movementTypes,
}: {
  initialMovements: StockMovementRow[];
  assets: AssetOption[];
  locations: LookupOption[];
  movementTypes: LookupOption[];
}) {
  const [assetFilter, setAssetFilter] = useState(ALL_VALUE);
  const [locationFilter, setLocationFilter] = useState(ALL_VALUE);
  const [typeFilter, setTypeFilter] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    return initialMovements.filter((movement) => {
      if (assetFilter !== ALL_VALUE && movement.asset.id !== assetFilter) return false;
      if (typeFilter !== ALL_VALUE && movement.movementType.id !== typeFilter) return false;
      if (
        locationFilter !== ALL_VALUE &&
        movement.originLocation?.id !== locationFilter &&
        movement.destinationLocation?.id !== locationFilter
      ) {
        return false;
      }
      return true;
    });
  }, [initialMovements, assetFilter, locationFilter, typeFilter]);

  const columns = useMemo<ColumnDef<StockMovementRow>[]>(
    () => [
      {
        id: "executedAt",
        accessorFn: (row) => row.executedAt,
        header: ({ column }) => <SortableHeader column={column} label="Data" />,
        cell: ({ row }) => formatDateTime(row.original.executedAt),
      },
      {
        id: "asset",
        accessorFn: (row) => row.asset.name,
        header: ({ column }) => <SortableHeader column={column} label="Ativo" />,
        cell: ({ row }) => row.original.asset.name,
      },
      {
        id: "detail",
        accessorFn: (row) => row.assetUnit?.serialNumber ?? row.assetUnit?.patrimonyNumber ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Detalhe" />,
        cell: ({ row }) =>
          row.original.assetUnit?.serialNumber ??
          row.original.assetUnit?.patrimonyNumber ??
          "—",
      },
      {
        id: "type",
        accessorFn: (row) => row.movementType.name,
        header: ({ column }) => <SortableHeader column={column} label="Tipo" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.movementType.name}</Badge>,
      },
      {
        id: "quantity",
        accessorFn: (row) => row.quantity,
        header: ({ column }) => <SortableHeader column={column} label="Quantidade" />,
        cell: ({ row }) => row.original.quantity,
      },
      {
        id: "destination",
        accessorFn: (row) => row.destinationLocation?.name ?? "",
        header: ({ column }) => <SortableHeader column={column} label="Destino" />,
        cell: ({ row }) => row.original.destinationLocation?.name ?? "—",
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([{ id: "executedAt", desc: true }]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Histórico de movimentações</h2>
        <p className="text-sm text-muted-foreground">
          Entradas registradas para ativos por quantidade e por série/patrimônio.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={{
            [ALL_VALUE]: "Todos os ativos",
            ...Object.fromEntries(assets.map((a) => [a.id, a.name])),
          }}
          value={assetFilter}
          onValueChange={(value) => setAssetFilter(value ?? ALL_VALUE)}
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
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value ?? ALL_VALUE)}
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
          value={locationFilter}
          onValueChange={(value) => setLocationFilter(value ?? ALL_VALUE)}
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
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {initialMovements.length
                    ? "Nenhuma movimentação encontrada para os filtros aplicados."
                    : "Nenhuma movimentação registrada ainda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
