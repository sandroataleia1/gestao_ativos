"use client";

import { useMemo } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isCustodyOverdue } from "@/lib/custodies/badge";
import { formatDateOnlyBR } from "@/lib/date-only";
import type { CustodyRow } from "./types";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

const SIGNATURE_STATUS_BADGE: Record<
  "PENDING" | "SENT" | "SIGNED",
  { label: string; variant: "default" | "outline" }
> = {
  SIGNED: { label: "Assinado", variant: "default" },
  SENT: { label: "Enviado (WhatsApp)", variant: "outline" },
  PENDING: { label: "Aguardando assinatura", variant: "outline" },
};

/** Busca/paginação server-side (via URL — ver app/(app)/custodies/page.tsx);
 * ordenação continua fixa por `deliveredAt desc` (mesmo padrão de
 * StockMovementsTable — é um histórico cronológico, não um cadastro que se
 * reordena por qualquer coluna). */
export function CustodyTable({
  rows,
  total,
  page,
  pageSize,
  emptyMessage,
  canManage,
  showStatus = false,
  onReturn,
  onOpenDocuments,
  onOpenQr,
  onCreateNew,
}: {
  rows: CustodyRow[];
  total: number;
  page: number;
  pageSize: number;
  emptyMessage: string;
  canManage: boolean;
  showStatus?: boolean;
  onReturn?: (custody: CustodyRow) => void;
  onOpenDocuments?: (custody: CustodyRow) => void;
  onOpenQr?: (custody: CustodyRow) => void;
  onCreateNew?: () => void;
}) {
  const columns = useMemo<ColumnDef<CustodyRow>[]>(() => {
    const base: ColumnDef<CustodyRow>[] = [
      {
        id: "employee",
        accessorFn: (row) => row.employee.name,
        header: "Colaborador",
        cell: ({ row }) => row.original.employee.name,
      },
      {
        id: "asset",
        accessorFn: (row) => row.asset.name,
        header: "Ativo",
        cell: ({ row }) => (
          <div className="grid">
            <span>{row.original.asset.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.assetUnit
                ? (row.original.assetUnit.serialNumber ??
                  row.original.assetUnit.patrimonyNumber ??
                  "Unidade sem identificação")
                : `${row.original.quantity} ${row.original.asset.defaultUnit ?? ""}`.trim()}
            </span>
          </div>
        ),
      },
      {
        id: "deliveredAt",
        accessorFn: (row) => row.deliveredAt,
        header: "Entregue em",
        cell: ({ row }) => formatDate(row.original.deliveredAt),
      },
      {
        id: "expectedReturnAt",
        accessorFn: (row) => row.expectedReturnAt ?? "",
        header: "Previsão de devolução",
        cell: ({ row }) => {
          const overdue = isCustodyOverdue(row.original);
          return (
            <span className={overdue ? "font-medium text-destructive" : undefined}>
              {formatDateOnlyBR(row.original.expectedReturnAt)}
              {overdue ? " (atrasado)" : ""}
            </span>
          );
        },
      },
      {
        id: "signature",
        accessorFn: (row) => row.signatureRequest?.status ?? "",
        header: "Assinatura",
        cell: ({ row }) => {
          const signatureRequest = row.original.signatureRequest;
          if (!signatureRequest) return <span className="text-muted-foreground">—</span>;
          const badge = SIGNATURE_STATUS_BADGE[signatureRequest.status];
          return <Badge variant={badge.variant}>{badge.label}</Badge>;
        },
      },
    ];

    if (showStatus) {
      base.push({
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "ACTIVE" ? "default" : "outline"}>
            {row.original.status === "ACTIVE" ? "Ativa" : "Devolvida"}
          </Badge>
        ),
      });
      base.push({
        id: "returnedAt",
        accessorFn: (row) => row.returnedAt ?? "",
        header: "Devolvido em",
        cell: ({ row }) => formatDate(row.original.returnedAt),
      });
    }

    if (onOpenDocuments || onOpenQr || (canManage && onReturn)) {
      base.push({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            {onOpenDocuments ? (
              <Button size="sm" variant="ghost" onClick={() => onOpenDocuments(row.original)}>
                Documentos
              </Button>
            ) : null}
            {onOpenQr ? (
              <Button size="sm" variant="ghost" onClick={() => onOpenQr(row.original)}>
                QR Code
              </Button>
            ) : null}
            {canManage && onReturn && row.original.status === "ACTIVE" ? (
              <Button size="sm" variant="outline" onClick={() => onReturn(row.original)}>
                Devolver
              </Button>
            ) : null}
          </div>
        ),
      });
    }

    return base;
  }, [showStatus, canManage, onReturn, onOpenDocuments, onOpenQr]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid gap-3 pt-4">
      <DebouncedSearchInput placeholder="Buscar por colaborador ou ativo..." className="w-full max-w-xs" />

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
                    <p>{emptyMessage}</p>
                    {onCreateNew ? (
                      <Button size="sm" onClick={onCreateNew}>
                        <PlusIcon />
                        Nova entrega
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
    </div>
  );
}
