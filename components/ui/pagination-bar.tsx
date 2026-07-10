"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Barra de paginação server-side reutilizável — reflete/atualiza `page` na
 * URL (mesmo padrão de router.push + URLSearchParams já usado no FiltersBar
 * de app/(app)/reports/reports-view.tsx). `total` é a contagem total de
 * linhas que atendem ao filtro atual (não só as da página carregada). */
export function PaginationBar({
  page,
  pageSize,
  total,
  paramKey = "page",
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Permite mais de uma tabela paginada na mesma página (ex.: /stock). */
  paramKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  function goToPage(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete(paramKey);
    else params.set(paramKey, String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        {start}–{end} de {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
          <ChevronLeftIcon />
          Anterior
        </Button>
        <span>
          Página {page} de {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
          Próxima
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
