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
import type { CustodyDocumentRow, CustodyDocumentType, CustodyPhotoRow, CustodyRow } from "./types";

const DOCUMENT_TYPE_LABEL: Record<CustodyDocumentType, string> = {
  DELIVERY_TERM: "Termo de entrega",
  RETURN_TERM: "Termo de devolução",
};

const PHOTO_KIND_LABEL: Record<CustodyPhotoRow["kind"], string> = {
  DELIVERY: "Fotos da entrega",
  RETURN: "Fotos da devolução",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export function CustodyDocumentsDialog({
  custody,
  onOpenChange,
  canManage,
}: {
  custody: CustodyRow | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const [documents, setDocuments] = useState<CustodyDocumentRow[]>([]);
  const [photos, setPhotos] = useState<CustodyPhotoRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatingType, setGeneratingType] = useState<CustodyDocumentType | null>(null);
  const [viewing, setViewing] = useState<CustodyDocumentRow | null>(null);
  const [signing, setSigning] = useState<CustodyDocumentRow | null>(null);

  useEffect(() => {
    if (!custody) {
      setDocuments([]);
      setPhotos([]);
      setViewing(null);
      setSigning(null);
      return;
    }
    void loadDocuments(custody.id);
    void loadPhotos(custody.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custody?.id]);

  async function loadDocuments(custodyId: string) {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/custodies/${custodyId}/documents`);
      if (!response.ok) return;
      const data = await response.json();
      setDocuments(data.documents);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPhotos(custodyId: string) {
    const response = await fetch(`/api/custodies/${custodyId}/photos`);
    if (!response.ok) return;
    const data = await response.json();
    setPhotos(data.photos);
  }

  async function generate(type: CustodyDocumentType) {
    if (!custody) return;
    setGeneratingType(type);
    try {
      const response = await fetch(`/api/custodies/${custody.id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error ?? "Não foi possível gerar o termo.");
        return;
      }

      toast.success("Termo gerado.");
      await loadDocuments(custody.id);
    } finally {
      setGeneratingType(null);
    }
  }

  return (
    <>
      <Dialog open={!!custody} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Documentos de custódia</DialogTitle>
            <DialogDescription>
              {custody ? `${custody.employee.name} — ${custody.asset.name}` : null}
            </DialogDescription>
          </DialogHeader>

          {custody ? (
            <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
              {/* O termo de entrega é gerado automaticamente ao registrar a
                  entrega (ver deliver-form.tsx — QR Code ou WhatsApp), então
                  não há mais botão manual pra ele aqui. O de devolução ainda
                  não tem esse fluxo automático, por isso continua manual. */}
              {canManage && custody.status === "RETURNED" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => generate("RETURN_TERM")}
                      disabled={generatingType !== null}
                    >
                      {generatingType === "RETURN_TERM" ? (
                        <Loader2Icon className="animate-spin" />
                      ) : null}
                      Gerar termo de devolução
                    </Button>
                  </div>
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
                          <p className="text-xs text-muted-foreground">
                            Gerado em {formatDateTime(document.generatedAt)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(document)}>
                            Visualizar
                          </Button>
                          {/* Termo de entrega é assinado pelo próprio
                              colaborador (QR Code/WhatsApp) — só o de
                              devolução ainda depende de captura manual aqui. */}
                          {canManage && document.type === "RETURN_TERM" ? (
                            <Button size="sm" variant="ghost" onClick={() => setSigning(document)}>
                              Assinar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {document.signatures.length ? (
                        <ul className="mt-2 grid gap-2">
                          {document.signatures.map((signature) => {
                            const signatureImage = signature.signatureData ?? signature.signatureImageUrl;
                            return (
                              <li key={signature.id} className="flex items-center gap-3">
                                {signatureImage ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={signatureImage}
                                    alt={`Assinatura de ${signature.signerName}`}
                                    className="h-14 w-32 shrink-0 rounded border bg-white object-contain"
                                  />
                                ) : null}
                                <p className="text-xs text-muted-foreground">
                                  Assinado por {signature.signerName} ({signature.signerDocument}) em{" "}
                                  {formatDateTime(signature.signedAt)}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Nenhuma assinatura registrada.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum termo gerado ainda.</p>
              )}

              {photos.length ? (
                <>
                  <Separator />
                  <div className="grid gap-3">
                    {(["DELIVERY", "RETURN"] as const).map((kind) => {
                      const kindPhotos = photos.filter((photo) => photo.kind === kind);
                      if (!kindPhotos.length) return null;
                      return (
                        <div key={kind} className="grid gap-2">
                          <p className="text-sm font-medium">{PHOTO_KIND_LABEL[kind]}</p>
                          <div className="flex flex-wrap gap-2">
                            {kindPhotos.map((photo) => (
                              <a
                                key={photo.id}
                                href={photo.dataUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="size-20 shrink-0 overflow-hidden rounded-lg border"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={photo.dataUrl}
                                  alt={PHOTO_KIND_LABEL[kind]}
                                  className="size-full object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <CustodyTermViewer document={viewing} onOpenChange={(open) => !open && setViewing(null)} />

      <SignatureCaptureDialog
        document={signing}
        custodyId={custody?.id ?? ""}
        onOpenChange={(open) => !open && setSigning(null)}
        onSuccess={() => {
          setSigning(null);
          if (custody) void loadDocuments(custody.id);
        }}
      />
    </>
  );
}

function CustodyTermViewer({
  document,
  onOpenChange,
}: {
  document: CustodyDocumentRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document ? DOCUMENT_TYPE_LABEL[document.type] : "Termo"}</DialogTitle>
        </DialogHeader>
        {document ? (
          <div
            className="max-h-[70vh] overflow-y-auto rounded-lg border bg-card p-4 text-sm [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: document.contentHtml }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SignatureCaptureDialog({
  document,
  custodyId,
  onOpenChange,
  onSuccess,
}: {
  document: CustodyDocumentRow | null;
  custodyId: string;
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
    if (document) {
      setSignerName("");
      setSignerDocument("");
      setHasDrawn(false);
      setFormError(null);
      clearCanvas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document]);

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
    if (!document) return;

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
      const response = await fetch(`/api/custodies/${custodyId}/signatures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          signerName,
          signerDocument,
          signatureData,
        }),
      });

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
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assinar termo</DialogTitle>
          <DialogDescription>{document ? DOCUMENT_TYPE_LABEL[document.type] : null}</DialogDescription>
        </DialogHeader>

        {document ? (
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
