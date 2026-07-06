"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { PlusIcon, SearchIcon } from "lucide-react";

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
import type { LookupOption, StockRow } from "./types";

const ALL_VALUE = "all";

export function StockTable({
  initialStock,
  categories,
  locations,
  canManage,
}: {
  initialStock: StockRow[];
  categories: LookupOption[];
  locations: LookupOption[];
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_VALUE);
  const [locationFilter, setLocationFilter] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialStock.filter((row) => {
      if (categoryFilter !== ALL_VALUE && row.asset.category.id !== categoryFilter) return false;
      if (locationFilter !== ALL_VALUE && row.locationId !== locationFilter) return false;
      if (!q) return true;
      return (
        row.asset.name.toLowerCase().includes(q) || row.asset.assetCode.toLowerCase().includes(q)
      );
    });
  }, [initialStock, search, categoryFilter, locationFilter]);

  const columns = useMemo<ColumnDef<StockRow>[]>(
    () => [
      {
        id: "asset",
        accessorFn: (row) => row.asset.name,
        header: ({ column }) => <SortableHeader column={column} label="Ativo" />,
        cell: ({ row }) => row.original.asset.name,
      },
      {
        id: "code",
        accessorFn: (row) => row.asset.assetCode,
        header: ({ column }) => <SortableHeader column={column} label="Código" />,
        cell: ({ row }) => row.original.asset.assetCode,
      },
      {
        id: "category",
        accessorFn: (row) => row.asset.category.name,
        header: ({ column }) => <SortableHeader column={column} label="Categoria" />,
        cell: ({ row }) => row.original.asset.category.name,
      },
      {
        id: "location",
        accessorFn: (row) => row.location.name,
        header: ({ column }) => <SortableHeader column={column} label="Local" />,
        cell: ({ row }) => row.original.location.name,
      },
      {
        id: "trackingMode",
        accessorFn: (row) => row.asset.trackingMode,
        header: ({ column }) => <SortableHeader column={column} label="Controle" />,
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.asset.trackingMode === "INDIVIDUAL" ? "Série" : "Quantidade"}
          </Badge>
        ),
      },
      {
        id: "quantity",
        accessorFn: (row) => row.quantity,
        header: ({ column }) => <SortableHeader column={column} label="Saldo" />,
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.quantity}
            {row.original.asset.defaultUnit ? ` ${row.original.asset.defaultUnit}` : ""}
          </span>
        ),
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou código..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-64 pl-8"
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

        {canManage ? (
          <Button render={<Link href="/stock/new" />}>
            <PlusIcon />
            Nova entrada
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
                      {initialStock.length
                        ? "Nenhum saldo encontrado para os filtros aplicados."
                        : "Nenhum saldo de estoque registrado ainda."}
                    </p>
                    {canManage && !initialStock.length ? (
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
    </div>
  );
}
