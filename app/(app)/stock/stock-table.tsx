"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";

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
import type { StockSortField } from "@/lib/stock";
import type { LookupOption, StockRow } from "./types";

const ALL_VALUE = "all";

export function StockTable({
  initialStock,
  total,
  page,
  pageSize,
  sort,
  dir,
  categories,
  locations,
  canManage,
}: {
  initialStock: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: StockSortField;
  dir: "asc" | "desc";
  categories: LookupOption[];
  locations: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === ALL_VALUE) params.delete(key);
    else params.set(key, value);
    params.delete("stockPage");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasActiveFilters = Boolean(
    searchParams.get("stockQ") || searchParams.get("stockCategoryId") || searchParams.get("stockLocationId"),
  );

  const columns = useMemo<ColumnDef<StockRow>[]>(() => {
    const headerFor = (field: StockSortField, label: string) => (
      <ServerSortableHeader
        field={field}
        label={label}
        currentField={sort}
        currentDir={dir}
        paramPrefix="stock"
        pageParamKey="stockPage"
      />
    );

    return [
      {
        id: "asset",
        accessorFn: (row) => row.asset.name,
        header: () => headerFor("asset", "Ativo"),
        cell: ({ row }) => row.original.asset.name,
      },
      {
        id: "code",
        accessorFn: (row) => row.asset.assetCode,
        header: () => headerFor("code", "Código"),
        cell: ({ row }) => row.original.asset.assetCode,
      },
      {
        id: "category",
        accessorFn: (row) => row.asset.category.name,
        header: () => headerFor("category", "Categoria"),
        cell: ({ row }) => row.original.asset.category.name,
      },
      {
        id: "location",
        accessorFn: (row) => row.location.name,
        header: () => headerFor("location", "Local"),
        cell: ({ row }) => row.original.location.name,
      },
      {
        id: "trackingMode",
        accessorFn: (row) => row.asset.trackingMode,
        header: () => headerFor("trackingMode", "Controle"),
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.asset.trackingMode === "INDIVIDUAL" ? "Série" : "Quantidade"}
          </Badge>
        ),
      },
      {
        id: "quantity",
        accessorFn: (row) => row.quantity,
        header: () => headerFor("quantity", "Saldo"),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.quantity}
            {row.original.asset.defaultUnit ? ` ${row.original.asset.defaultUnit}` : ""}
          </span>
        ),
      },
    ];
  }, [sort, dir]);

  const table = useReactTable({
    data: initialStock,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DebouncedSearchInput
            paramKey="stockQ"
            pageParamKey="stockPage"
            placeholder="Buscar por nome ou código..."
            className="w-64"
          />

          <Select
            items={{
              [ALL_VALUE]: "Todas as categorias",
              ...Object.fromEntries(categories.map((c) => [c.id, c.name])),
            }}
            value={searchParams.get("stockCategoryId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("stockCategoryId", value as string)}
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
            value={searchParams.get("stockLocationId") ?? ALL_VALUE}
            onValueChange={(value) => applyFilter("stockLocationId", value as string)}
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
                      {hasActiveFilters
                        ? "Nenhum saldo encontrado para os filtros aplicados."
                        : "Nenhum saldo de estoque registrado ainda."}
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

      <PaginationBar page={page} pageSize={pageSize} total={total} paramKey="stockPage" />
    </div>
  );
}
