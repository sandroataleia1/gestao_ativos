"use client";

import { QRCodeSVG } from "qrcode.react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function copyLink(signUrl: string) {
  navigator.clipboard.writeText(signUrl).then(
    () => toast.success("Link copiado."),
    () => toast.error("Não foi possível copiar o link."),
  );
}

/**
 * Mostrado logo após registrar a entrega quando o modo de assinatura
 * escolhido foi "QR" (presencial) — o colaborador lê o QR Code com o
 * próprio celular ali mesmo, abre o termo em app/assinar/[token] e assina
 * por lá, sem precisar digitar/desenhar nada no aparelho de quem entregou.
 */
export function SignatureQrDialog({
  open,
  onOpenChange,
  signUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signUrl: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assinatura do colaborador</DialogTitle>
          <DialogDescription>
            Peça para o colaborador escanear o QR Code, ler o termo e assinar pelo próprio celular.
          </DialogDescription>
        </DialogHeader>

        {signUrl ? (
          <div className="grid gap-3">
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={signUrl} size={220} />
            </div>
            <p className="break-all text-xs text-muted-foreground">{signUrl}</p>
            <Button type="button" variant="outline" onClick={() => copyLink(signUrl)}>
              <CopyIcon />
              Copiar link
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
