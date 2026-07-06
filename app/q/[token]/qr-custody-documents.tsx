"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DocumentSummary = { id: string; type: string; generatedAt: string; signed: boolean };

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  DELIVERY_TERM: "Termo de entrega",
  RETURN_TERM: "Termo de devolução",
};

/**
 * Requisito 7: o QR de custódia mostra o status da assinatura (assinado ou
 * pendente) para qualquer visitante — o botão "Ver termo" (conteúdo
 * completo) só aparece quando `canView` é true, e mesmo assim a chamada
 * cai em GET /api/custodies/[id]/documents, que já reforça `custody:view`
 * no servidor (defesa em profundidade, não confia só em esconder o botão).
 */
export function QrCustodyDocuments({
  custodyId,
  documents,
  canView,
}: {
  custodyId: string;
  documents: DocumentSummary[];
  canView: boolean;
}) {
  const [viewing, setViewing] = useState<{ contentHtml: string; type: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function view(documentId: string, type: string) {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/custodies/${custodyId}/documents`);
      if (!response.ok) return;
      const data = await response.json();
      const found = data.documents.find((document: { id: string }) => document.id === documentId);
      if (found) setViewing({ contentHtml: found.contentHtml, type });
    } finally {
      setIsLoading(false);
    }
  }

  if (documents.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum termo gerado para esta entrega.</p>;
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Documentos</p>
      {documents.map((document) => (
        <div
          key={document.id}
          className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <span>{DOCUMENT_TYPE_LABEL[document.type] ?? document.type}</span>
            <Badge variant={document.signed ? "default" : "outline"}>
              {document.signed ? "Assinado" : "Pendente de assinatura"}
            </Badge>
          </div>
          {canView ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={isLoading}
              onClick={() => view(document.id, document.type)}
            >
              Ver termo
            </Button>
          ) : null}
        </div>
      ))}

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing ? (DOCUMENT_TYPE_LABEL[viewing.type] ?? viewing.type) : "Termo"}</DialogTitle>
          </DialogHeader>
          {viewing ? (
            <div
              className="max-h-[70vh] overflow-y-auto rounded-lg border bg-card p-4 text-sm [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: viewing.contentHtml }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
