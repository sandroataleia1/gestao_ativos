"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Sprint SST 1.4H, fatia 2 — espelha app/(app)/custodies/custody-documents-dialog.tsx
// (docs/custody-documents.md), adaptado: lista de presença é 1 documento
// da turma com uma assinatura por participante (não um assinante genérico
// por termo); certificado nunca é assinado aqui (gerado a partir da tabela
// de participantes, ver participants-table.tsx).

type TrainingDocumentType = "ATTENDANCE_LIST" | "CERTIFICATE";

const DOCUMENT_TYPE_LABEL: Record<TrainingDocumentType, string> = {
  ATTENDANCE_LIST: "Lista de presença",
  CERTIFICATE: "Certificado",
};

type SignatureRow = {
  id: string;
  participantId: string;
  signerName: string;
  signerDocument: string;
  signatureData: string | null;
  signatureImageUrl: string | null;
  signedAt: string;
};

type TrainingDocumentRow = {
  id: string;
  type: TrainingDocumentType;
  contentHtml: string;
  generatedAt: string;
  participantId: string | null;
  signatures: SignatureRow[];
};

type EnrolledParticipant = {
  id: string;
  employee: { name: string; document: string; registration: string | null };
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export function TrainingDocumentsDialog({
  open,
  onOpenChange,
  trainingClassId,
  requiresAttendanceList,
  canGenerateAttendanceList,
  canManage,
  enrolledParticipants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainingClassId: string;
  requiresAttendanceList: boolean;
  canGenerateAttendanceList: boolean;
  canManage: boolean;
  enrolledParticipants: EnrolledParticipant[];
}) {
  const [documents, setDocuments] = useState<TrainingDocumentRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewing, setViewing] = useState<TrainingDocumentRow | null>(null);
  const [signingContext, setSigningContext] = useState<{ document: TrainingDocumentRow; participant: EnrolledParticipant } | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setDocuments([]);
      return;
    }
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadDocuments() {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/training-classes/${trainingClassId}/documents`);
      if (!response.ok) return;
      const data = await response.json();
      setDocuments(data.documents);
    } finally {
      setIsLoading(false);
    }
  }

  async function generateAttendanceList() {
    setIsGenerating(true);
    try {
      const response = await fetch(`/api/training-classes/${trainingClassId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ATTENDANCE_LIST" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error ?? "Não foi possível gerar a lista de presença.");
        return;
      }
      toast.success("Lista de presença gerada.");
      await loadDocuments();
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Documentos da turma</DialogTitle>
            <DialogDescription>Lista de presença e certificados gerados para esta turma.</DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            {canManage && requiresAttendanceList ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={generateAttendanceList} disabled={isGenerating || !canGenerateAttendanceList}>
                    {isGenerating ? <Loader2Icon className="animate-spin" /> : null}
                    Gerar lista de presença
                  </Button>
                </div>
                {!canGenerateAttendanceList ? (
                  <p className="text-xs text-muted-foreground">
                    Só é possível gerar a lista de presença depois que a turma começar.
                  </p>
                ) : null}
                <Separator />
              </>
            ) : null}

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : documents.length ? (
              <div className="grid gap-3">
                {documents.map((document) => (
                  <div key={document.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{DOCUMENT_TYPE_LABEL[document.type]}</p>
                        <p className="text-xs text-muted-foreground">Gerado em {formatDateTime(document.generatedAt)}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setViewing(document)}>
                        Visualizar
                      </Button>
                    </div>

                    {document.type === "ATTENDANCE_LIST" ? (
                      <ul className="mt-2 grid gap-1.5">
                        {enrolledParticipants.map((participant) => {
                          const signature = document.signatures.find((s) => s.participantId === participant.id);
                          return (
                            <li key={participant.id} className="flex items-center justify-between gap-2 text-xs">
                              <span>{participant.employee.name}</span>
                              {signature ? (
                                <span className="text-muted-foreground">
                                  Assinado em {formatDateTime(signature.signedAt)}
                                </span>
                              ) : canManage ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setSigningContext({ document, participant })}
                                >
                                  Assinar
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">Não assinado</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum documento gerado ainda.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TrainingDocumentViewer document={viewing} onOpenChange={(next) => !next && setViewing(null)} />

      <SignatureCaptureDialog
        context={signingContext}
        trainingClassId={trainingClassId}
        onOpenChange={(next) => !next && setSigningContext(null)}
        onSuccess={() => {
          setSigningContext(null);
          void loadDocuments();
        }}
      />
    </>
  );
}

function TrainingDocumentViewer({
  document,
  onOpenChange,
}: {
  document: TrainingDocumentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document ? DOCUMENT_TYPE_LABEL[document.type] : "Documento"}</DialogTitle>
        </DialogHeader>
        {document ? (
          <div
            className="max-h-[70vh] overflow-y-auto rounded-lg border bg-card p-4 text-sm [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:p-1.5 [&_th]:border [&_th]:p-1.5 [&_p]:mb-2"
            dangerouslySetInnerHTML={{ __html: document.contentHtml }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignatureCaptureDialog({
  context,
  trainingClassId,
  onOpenChange,
  onSuccess,
}: {
  context: { document: TrainingDocumentRow; participant: EnrolledParticipant } | null;
  trainingClassId: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerDocument, setSignerDocument] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (context) {
      setSignerName(context.participant.employee.name);
      setSignerDocument(context.participant.employee.document);
      setHasDrawn(false);
      setFormError(null);
      clearCanvas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasPoint(event);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function handlePointerUp() {
    isDrawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!context) return;

    if (!signerName.trim() || !signerDocument.trim()) {
      setFormError("Informe nome e documento do assinante.");
      return;
    }
    if (!hasDrawn) {
      setFormError("Capture a assinatura no campo abaixo.");
      return;
    }

    const signatureData = canvasRef.current?.toDataURL("image/png");

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/training-classes/${trainingClassId}/documents/${context.document.id}/signatures`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: context.participant.id,
            signerName,
            signerDocument,
            signatureData,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível salvar a assinatura.");
        return;
      }

      toast.success("Assinatura registrada.");
      onSuccess();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={!!context} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinar lista de presença</DialogTitle>
          <DialogDescription>{context?.participant.employee.name}</DialogDescription>
        </DialogHeader>

        {context ? (
          <form onSubmit={handleSubmit} className="grid gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="signer-name">Nome do assinante</Label>
                <Input
                  id="signer-name"
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="signer-document">Documento</Label>
                <Input
                  id="signer-document"
                  value={signerDocument}
                  onChange={(event) => setSignerDocument(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Assinatura</Label>
              <canvas
                ref={canvasRef}
                width={480}
                height={160}
                className="w-full touch-none rounded-lg border bg-white"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />
              <Button type="button" variant="ghost" size="sm" onClick={clearCanvas} disabled={isSubmitting}>
                Limpar
              </Button>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                Salvar assinatura
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
