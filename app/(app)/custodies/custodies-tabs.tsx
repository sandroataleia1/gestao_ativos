"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCodeDialog } from "@/components/qr/qr-code-dialog";
import { isCustodyOverdue } from "@/lib/custodies/badge";
import { CustodyDocumentsDialog } from "./custody-documents-dialog";
import { CustodyTable } from "./custody-table";
import { ReturnDialog } from "./return-dialog";
import type { CustodyRow, LookupOption } from "./types";

export function CustodiesTabs({
  initialActive,
  initialHistory,
  conditions,
  canManage,
}: {
  initialActive: CustodyRow[];
  initialHistory: CustodyRow[];
  conditions: LookupOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [returnTarget, setReturnTarget] = useState<CustodyRow | null>(null);
  const [documentsTarget, setDocumentsTarget] = useState<CustodyRow | null>(null);
  const [qrTarget, setQrTarget] = useState<CustodyRow | null>(null);

  const overdue = useMemo(() => initialActive.filter(isCustodyOverdue), [initialActive]);

  function refresh() {
    setReturnTarget(null);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <Tabs defaultValue="active">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="active">Em posse do colaborador</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
            <TabsTrigger value="overdue">Pendências de devolução ({overdue.length})</TabsTrigger>
          </TabsList>

          {canManage ? (
            <Button render={<Link href="/custodies/new" />}>
              <PlusIcon />
              Nova entrega
            </Button>
          ) : null}
        </div>

        <TabsContent value="active">
          <CustodyTable
            rows={initialActive}
            emptyMessage="Nenhuma custódia ativa."
            canManage={canManage}
            onReturn={setReturnTarget}
            onOpenDocuments={setDocumentsTarget}
            onOpenQr={canManage ? setQrTarget : undefined}
            onCreateNew={canManage ? () => router.push("/custodies/new") : undefined}
          />
        </TabsContent>
        <TabsContent value="history">
          <CustodyTable
            rows={initialHistory}
            emptyMessage="Nenhuma custódia registrada."
            canManage={false}
            showStatus
            onOpenDocuments={setDocumentsTarget}
            onOpenQr={canManage ? setQrTarget : undefined}
          />
        </TabsContent>
        <TabsContent value="overdue">
          <CustodyTable
            rows={overdue}
            emptyMessage="Nenhuma devolução pendente."
            canManage={canManage}
            onReturn={setReturnTarget}
            onOpenDocuments={setDocumentsTarget}
            onOpenQr={canManage ? setQrTarget : undefined}
          />
        </TabsContent>
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
