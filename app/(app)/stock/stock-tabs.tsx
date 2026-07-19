"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StockSortField } from "@/lib/stock";
import { StockTable } from "./stock-table";
import { StockMovementsTable } from "./stock-movements-table";
import type { AssetOption, LookupOption, StockMovementRow, StockRow } from "./types";

export type StockView = "balance" | "history";

/** Saldo e histórico de movimentações viviam sempre visíveis, empilhados na
 * mesma tela — duas tabelas cheias uma embaixo da outra davam a impressão de
 * informação duplicada. Em abas (mesmo padrão de
 * app/(app)/custodies/custodies-tabs.tsx), só uma é exibida por vez; a
 * troca de aba navega via `?view=`, então o servidor só busca as linhas da
 * aba ativa (ver app/(app)/stock/page.tsx). */
export function StockTabs({
  view,
  stock,
  stockTotal,
  stockPage,
  stockPageSize,
  stockSort,
  stockDir,
  movements,
  movTotal,
  movPage,
  movPageSize,
  assets,
  categories,
  locations,
  movementTypes,
  canManage,
}: {
  view: StockView;
  stock: StockRow[];
  stockTotal: number;
  stockPage: number;
  stockPageSize: number;
  stockSort: StockSortField;
  stockDir: "asc" | "desc";
  movements: StockMovementRow[];
  movTotal: number;
  movPage: number;
  movPageSize: number;
  assets: AssetOption[];
  categories: LookupOption[];
  locations: LookupOption[];
  movementTypes: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function changeView(nextView: string | null) {
    if (!nextView) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextView);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={view} onValueChange={changeView}>
      <TabsList>
        <TabsTrigger value="balance">Saldo em estoque</TabsTrigger>
        <TabsTrigger value="history">Histórico de movimentações</TabsTrigger>
      </TabsList>

      {view === "balance" ? (
        <StockTable
          initialStock={stock}
          total={stockTotal}
          page={stockPage}
          pageSize={stockPageSize}
          sort={stockSort}
          dir={stockDir}
          categories={categories}
          locations={locations}
          canManage={canManage}
        />
      ) : (
        <StockMovementsTable
          initialMovements={movements}
          total={movTotal}
          page={movPage}
          pageSize={movPageSize}
          assets={assets}
          locations={locations}
          movementTypes={movementTypes}
          canManage={canManage}
        />
      )}
    </Tabs>
  );
}
