"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCodeDialog } from "@/components/qr/qr-code-dialog";
import type { CustodyTab } from "@/lib/custodies";
import { CustodyDocumentsDialog } from "./custody-documents-dialog";
import { CustodyTable } from "./custody-table";
import { ReturnDialog } from "./return-dialog";
import type { CustodyRow, LookupOption } from "./types";

const TAB_EMPTY_MESSAGE: Record<CustodyTab, string> = {
  active: "Nenhuma custódia ativa.",
  history: "Nenhuma custódia registrada.",
  overdue: "Nenhuma devolução pendente.",
};

/** Cada aba busca sua própria página no servidor (troca de aba = navegação
 * com `?tab=`, mesmo padrão de app/(app)/reports/reports-view.tsx) — só a
 * aba ativa é buscada/renderizada por vez, em vez de carregar as três de
 * uma vez (a aba "ativa" antes não tinha NENHUM limite de linhas). */
export function CustodiesTabs({
  tab,
  rows,
  total,
  page,
  pageSize,
  overdueCount,
  conditions,
  canManage,
}: {
  tab: CustodyTab;
  rows: CustodyRow[];
  total: number;
  page: number;
  pageSize: number;
  overdueCount: number;
  conditions: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [returnTarget, setReturnTarget] = useState<CustodyRow | null>(null);
  const [documentsTarget, setDocumentsTarget] = useState<CustodyRow | null>(null);
  const [qrTarget, setQrTarget] = useState<CustodyRow | null>(null);

  function refresh() {
    setReturnTarget(null);
    router.refresh();
  }

  function changeTab(nextTab: string | null) {
    if (!nextTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    params.delete("page");
    params.delete("q");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      <Tabs value={tab} onValueChange={changeTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="active">Em posse do colaborador</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
            <TabsTrigger value="overdue">Pendências de devolução ({overdueCount})</TabsTrigger>
          </TabsList>

          {canManage ? (
            <Button render={<Link href="/custodies/new" />}>
              <PlusIcon />
              Nova entrega
            </Button>
          ) : null}
        </div>

        <CustodyTable
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          emptyMessage={TAB_EMPTY_MESSAGE[tab]}
          canManage={tab !== "history" && canManage}
          showStatus={tab === "history"}
          onReturn={tab !== "history" ? setReturnTarget : undefined}
          onOpenDocuments={setDocumentsTarget}
          onOpenQr={canManage ? setQrTarget : undefined}
          onCreateNew={tab === "active" && canManage ? () => router.push("/custodies/new") : undefined}
        />
      </Tabs>

      {canManage ? (
        <ReturnDialog
          custody={returnTarget}
          onOpenChange={(open) => {
            if (!open) setReturnTarget(null);
          }}
          conditions={conditions}
          onSuccess={refresh}
        />
      ) : null}

      <CustodyDocumentsDialog
        custody={documentsTarget}
        onOpenChange={(open) => {
          if (!open) setDocumentsTarget(null);
        }}
        canManage={canManage}
      />

      <QrCodeDialog
        open={Boolean(qrTarget)}
        onOpenChange={(open) => {
          if (!open) setQrTarget(null);
        }}
        title="QR Code da entrega"
        description={qrTarget ? `${qrTarget.employee.name} — ${qrTarget.asset.name}` : undefined}
        sections={
          qrTarget
            ? [
                { label: "Ativo", resourceKind: "assets", resourceId: qrTarget.assetId },
                ...(qrTarget.assetUnitId
                  ? [
                      {
                        label: "Unidade (patrimônio)",
                        resourceKind: "asset-units" as const,
                        resourceId: qrTarget.assetUnitId,
                      },
                    ]
                  : []),
                { label: "Custódia (entrega)", resourceKind: "custodies", resourceId: qrTarget.id },
              ]
            : []
        }
      />
    </div>
  );
}
