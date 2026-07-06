"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CopyIcon, Loader2Icon, QrCodeIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type QrResourceKind = "assets" | "asset-units" | "custodies";

/**
 * Gera (ou recupera, se já existir) o token e mostra o QR Code de um único
 * recurso. Reaproveitado tanto no diálogo de um único recurso (Ativo) quanto
 * no diálogo multi-seção de custódia (Ativo + Unidade + Custódia).
 */
export function QrCodeSection({
  label,
  resourceKind,
  resourceId,
}: {
  label: string;
  resourceKind: QrResourceKind;
  resourceId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  async function generate() {
    setIsGenerating(true);
    try {
      const response = await fetch(`/api/${resourceKind}/${resourceId}/qr`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error ?? "Não foi possível gerar o QR Code.");
        return;
      }
      const data = await response.json();
      setUrl(`${window.location.origin}${data.url}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function copyLink() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copiado."),
      () => toast.error("Não foi possível copiar o link."),
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{label}</p>
      {url ? (
        <div className="grid gap-2">
          <div className="flex justify-center rounded-lg bg-white p-3">
            <QRCodeSVG value={url} size={160} />
          </div>
          <p className="break-all text-xs text-muted-foreground">{url}</p>
          <Button type="button" size="sm" variant="outline" onClick={copyLink}>
            <CopyIcon />
            Copiar link
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={generate} disabled={isGenerating}>
          {isGenerating ? <Loader2Icon className="animate-spin" /> : <QrCodeIcon />}
          Gerar QR Code
        </Button>
      )}
    </div>
  );
}
