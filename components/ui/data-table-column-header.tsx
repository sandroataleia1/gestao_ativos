"use client";

import type { Column } from "@tanstack/react-table";
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
