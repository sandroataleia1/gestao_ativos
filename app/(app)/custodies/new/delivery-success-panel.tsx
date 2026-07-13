"use client";

import Link from "next/link";
import { CheckCircle2Icon, CopyIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DeliverySummary } from "./wizard-logic";

function copyLink(signUrl: string) {
  navigator.clipboard.writeText(signUrl).then(
    () => toast.success("Link copiado."),
    () => toast.error("Não foi possível copiar o link."),
  );
}

// Tela de sucesso — Sprint Demo Comercial (Wizard de Nova Entrega), Parte
// 13. Só mostra ações realmente funcionais hoje (Parte 13: "não mostrar
// opções ainda não implementadas") — "Ver termo" ficou de fora de
// propósito: não existe uma rota dedicada de visualização do termo por
// custodyId sem construir uma nova (fora do escopo desta sprint, ver
// Parte 22 "novo modelo"/"refatoração ampla" — o termo já gerado continua
// acessível pelos Documentos da custódia na listagem).
export function DeliverySuccessPanel({
  summary,
  signUrl,
  whatsappWarning,
  onRegisterAnother,
}: {
  summary: DeliverySummary;
  signUrl: string | null;
  whatsappWarning: string | null;
  onRegisterAnother: () => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <CheckCircle2Icon className="size-6 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
        <h2 className="text-lg font-medium">Entrega registrada com sucesso</h2>
      </div>

      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
            <span className="text-muted-foreground">Colaborador</span>
            <span className="font-medium">{summary.employeeName}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
            <span className="text-muted-foreground">Item</span>
            <span className="font-medium">{summary.itemLabel}</span>
          </div>
          {summary.quantityOrSerial ? (
            <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
              <span className="text-muted-foreground">Quantidade / série</span>
              <span className="font-medium">{summary.quantityOrSerial}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
            <span className="text-muted-foreground">Termo</span>
            <span className="font-medium">Gerado</span>
          </div>
          <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
            <span className="text-muted-foreground">Assinatura</span>
            <span className="font-medium">
              {summary.signatureModeLabel}
              {whatsappWarning ? " — envio falhou, use o link abaixo" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {whatsappWarning ? <p className="text-sm text-amber-600 dark:text-amber-500">{whatsappWarning}</p> : null}

      {signUrl ? (
        <div className="grid gap-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Assinatura do colaborador</p>
          <div className="flex justify-center rounded-lg bg-white p-4">
            <QRCodeSVG value={signUrl} size={180} />
          </div>
          <p className="break-all text-xs text-muted-foreground">{signUrl}</p>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => copyLink(signUrl)}>
            <CopyIcon />
            Copiar link de assinatura
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onRegisterAnother}>
          Registrar nova entrega
        </Button>
        <Button type="button" render={<Link href="/custodies" />}>
          Ir para entregas
        </Button>
      </div>
    </div>
  );
}
