"use client";

import type { Column } from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function SortableHeader<TData, TValue>({
  column,
  label,
  className,
}: {
  column: Column<TData, TValue>;
  label: string;
  className?: string;
}) {
  const sorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "-mx-2 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left font-medium transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUpIcon className="size-3.5 text-foreground" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon className="size-3.5 text-foreground" />
      ) : (
        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/50" />
      )}
    </button>
  );
}

/** Equivalente a `SortableHeader`, mas para paginação/ordenação
 * server-side: em vez de alternar o estado local do TanStack Table, alterna
 * `sort`/`dir` na URL (sempre volta pra página 1). Usado nas listagens que
 * migraram para busca/ordenação no servidor (Ativos, Colaboradores, Estoque,
 * Custódias). */
export function ServerSortableHeader({
  field,
  label,
  currentField,
  currentDir,
  className,
  paramPrefix = "",
  pageParamKey = "page",
}: {
  field: string;
  label: string;
  currentField: string;
  currentDir: "asc" | "desc";
  className?: string;
  /** Permite mais de uma tabela paginada/ordenável na mesma página. */
  paramPrefix?: string;
  pageParamKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isActive = currentField === field;

  function toggleSort() {
    const params = new URLSearchParams(searchParams.toString());
    const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";
    params.set(`${paramPrefix}sort`, field);
    params.set(`${paramPrefix}dir`, nextDir);
    params.delete(pageParamKey);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={toggleSort}
      className={cn(
        "-mx-2 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left font-medium transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {label}
      {isActive ? (
        currentDir === "asc" ? (
          <ArrowUpIcon className="size-3.5 text-foreground" />
        ) : (
          <ArrowDownIcon className="size-3.5 text-foreground" />
        )
      ) : (
        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/50" />
      )}
    </button>
  );
}
