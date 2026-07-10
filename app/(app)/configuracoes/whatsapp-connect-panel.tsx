"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, MessageCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConnectionState = "idle" | "connecting" | "open";

const QR_REFRESH_MS = 25_000;
const STATUS_POLL_MS = 4_000;

/**
 * Fluxo self-service de conexão do WhatsApp — cada empresa clica, escaneia
 * o próprio QR Code e pronto, sem nunca ver/digitar URL ou API key da
 * Evolution API (isso é segredo de plataforma, resolvido no backend em
 * app/api/company/whatsapp-instance/*). Substitui o antigo formulário
 * manual de 3 campos.
 */
export function WhatsappConnectPanel({ initialHasInstance }: { initialHasInstance: boolean }) {
  const [state, setState] = useState<ConnectionState>(initialHasInstance ? "connecting" : "idle");
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimers() {
    if (qrIntervalRef.current) clearInterval(qrIntervalRef.current);
    if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    qrIntervalRef.current = null;
    statusIntervalRef.current = null;
  }

  async function fetchQr() {
    try {
      const response = await fetch("/api/company/whatsapp-instance/connect", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error ?? "Não foi possível conectar ao WhatsApp.");
        return;
      }
      if (data.state === "open") {
        setState("open");
        setQrCodeBase64(null);
        clearTimers();
      } else {
        setQrCodeBase64(data.qrCodeBase64 ?? null);
      }
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    }
  }

  async function pollStatus() {
    try {
      const response = await fetch("/api/company/whatsapp-instance/status");
      const data = await response.json().catch(() => null);
      if (data?.state === "open") {
        setState("open");
        setQrCodeBase64(null);
        clearTimers();
        toast.success("WhatsApp conectado.");
      }
    } catch {
      // Falha de polling não precisa de toast — tenta de novo no próximo tick.
    }
  }

  async function handleConnect() {
    setIsLoading(true);
    setState("connecting");
    try {
      await fetchQr();
      statusIntervalRef.current = setInterval(pollStatus, STATUS_POLL_MS);
      qrIntervalRef.current = setInterval(fetchQr, QR_REFRESH_MS);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/company/whatsapp-instance/disconnect", { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error ?? "Não foi possível desconectar.");
        return;
      }
      clearTimers();
      setState("idle");
      setQrCodeBase64(null);
      toast.success("WhatsApp desconectado.");
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  // Se a empresa já tinha uma instância configurada (ex.: recarregou a
  // página no meio do processo), retoma o polling/QR automaticamente.
  useEffect(() => {
    if (initialHasInstance) {
      void fetchQr();
      statusIntervalRef.current = setInterval(pollStatus, STATUS_POLL_MS);
      qrIntervalRef.current = setInterval(fetchQr, QR_REFRESH_MS);
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "open") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
          <span>WhatsApp conectado.</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmDisconnect(true)}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? <Loader2Icon className="animate-spin" /> : null}
          Desconectar
        </Button>

        <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desconectar WhatsApp?</AlertDialogTitle>
              <AlertDialogDescription>
                A empresa deixa de enviar o termo de responsabilidade por WhatsApp nas próximas
                entregas até que uma nova conexão seja feita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDisconnecting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await handleDisconnect();
                  setConfirmDisconnect(false);
                }}
                disabled={isDisconnecting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {isDisconnecting ? "Desconectando..." : "Desconectar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (state === "connecting") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Escaneie o QR Code pelo WhatsApp do celular (Aparelhos conectados → Conectar um aparelho).
        </p>
        {qrCodeBase64 ? (
          <div className="flex justify-center rounded-lg bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCodeBase64} alt="QR Code para conectar o WhatsApp" className="size-52" />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={handleDisconnect} disabled={isDisconnecting}>
          {isDisconnecting ? <Loader2Icon className="animate-spin" /> : null}
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Conecte o WhatsApp da sua empresa para enviar o termo de responsabilidade na entrega de ativos.
      </p>
      <Button type="button" onClick={handleConnect} disabled={isLoading}>
        {isLoading ? <Loader2Icon className="animate-spin" /> : <MessageCircleIcon />}
        Conectar WhatsApp
      </Button>
    </div>
  );
}
