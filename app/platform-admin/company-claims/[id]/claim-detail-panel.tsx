"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import type { ClaimDetailForAdmin } from "@/lib/platform-admin-detail";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const VERIFICATION_METHOD_LABELS: Record<string, string> = {
  BUSINESS_CONTACT_CONFIRMED: "Contato empresarial confirmado",
  EXTERNALLY_VERIFIED_DOCUMENTATION: "Documentação verificada externamente",
  INTERNAL_ANALYSIS: "Análise interna",
  OTHER: "Outro",
};

function formatDate(iso: string | Date) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

const REVIEW_NOTE_MIN = 10;

export function ClaimDetailPanel({ detail }: { detail: ClaimDetailForAdmin }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isStartingReview, setIsStartingReview] = useState(false);

  const [decisionDialog, setDecisionDialog] = useState<"approve" | "reject" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<string | undefined>(undefined);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);

  const canStartReview = detail.claim.status === "PENDING";
  const canDecide = detail.claim.status === "PENDING" || detail.claim.status === "UNDER_REVIEW";

  async function handleStartReview() {
    setError(null);
    setIsStartingReview(true);
    try {
      const res = await fetch(`/api/platform-admin/company-claims/${detail.claim.id}/start-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res));
        return;
      }
      toast.success("Análise iniciada.");
      router.refresh();
    } catch {
      setError("Não foi possível iniciar a análise. Tente novamente.");
    } finally {
      setIsStartingReview(false);
    }
  }

  function openDecisionDialog(kind: "approve" | "reject") {
    setError(null);
    setReviewNote("");
    setVerificationMethod(undefined);
    setDecisionDialog(kind);
  }

  async function handleDecisionSubmit() {
    if (!decisionDialog) return;
    setError(null);
    setIsSubmittingDecision(true);
    try {
      const res = await fetch(`/api/platform-admin/company-claims/${detail.claim.id}/${decisionDialog}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNote, ...(verificationMethod ? { verificationMethod } : {}) }),
      });
      if (!res.ok) {
        setError(await parseErrorMessage(res));
        return;
      }
      toast.success(decisionDialog === "approve" ? "Reivindicação aprovada." : "Reivindicação não aprovada.");
      setDecisionDialog(null);
      router.refresh();
    } catch {
      setError("Não foi possível concluir a ação. Tente novamente.");
    } finally {
      setIsSubmittingDecision(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {detail.company.controlStatus === "DISPUTED" ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-200">
          <AlertDescription>Esta empresa possui múltiplas solicitações de controle.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-zinc-50">{detail.company.name}</CardTitle>
          <Badge variant="outline" className="border-white/20 text-zinc-300">
            {detail.claim.status}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-zinc-400">CNPJ</dt>
              <dd className="text-zinc-50">{detail.company.cnpjMasked ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Origem da empresa</dt>
              <dd className="text-zinc-50">{detail.company.origin}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">controlStatus</dt>
              <dd className="text-zinc-50">{detail.company.controlStatus}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Empresa criada em</dt>
              <dd className="text-zinc-50">{formatDate(detail.company.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Solicitante</dt>
              <dd className="text-zinc-50">{detail.requester.emailMasked}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Solicitado em</dt>
              <dd className="text-zinc-50">{formatDate(detail.claim.requestedAt)}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Origem da solicitação</dt>
              <dd className="text-zinc-50">{detail.claim.origin}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Já possui administrador?</dt>
              <dd className="text-zinc-50">{detail.hasAdministrativeMembership ? "Sim" : "Não"}</dd>
            </div>
          </dl>
          {detail.claim.rejectionReason ? (
            <div>
              <p className="text-zinc-400">Justificativa registrada (histórico interno)</p>
              <p className="text-zinc-200">{detail.claim.rejectionReason}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {detail.competingClaims.length > 0 ? (
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-base text-zinc-50">Solicitações concorrentes desta empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {detail.competingClaims.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md border border-white/10 p-2">
                  <span className="text-zinc-300">{c.requesterEmailMasked}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="border-white/20 text-zinc-300">
                      {c.status}
                    </Badge>
                    <span className="text-zinc-500">{formatDate(c.requestedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {detail.provisionalProvider ? (
        <Card className="border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-base text-zinc-50">Consultoria provisória</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm text-zinc-300">
            <p>Existe uma consultoria provisória: {detail.provisionalProvider.providerNameMasked}</p>
            <p>Pré-cadastrada em {formatDate(detail.provisionalProvider.createdAt)}</p>
            <p>
              Nível atual: {detail.provisionalProvider.accessLevel} · Status: {detail.provisionalProvider.status}
            </p>
            <p className="text-zinc-500">
              A decisão de manter, alterar ou bloquear esta consultoria pertence à empresa, em /onboarding/sst-providers,
              depois que a reivindicação for aprovada.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base text-zinc-50">Linha do tempo</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.auditEvents.length === 0 ? (
            <p className="text-sm text-zinc-400">Nenhum evento registrado ainda.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {detail.auditEvents.map((event) => (
                <li key={event.id} className="flex items-center justify-between rounded-md border border-white/10 p-2">
                  <span className="text-zinc-300">{event.action}</span>
                  <span className="text-zinc-500">{formatDate(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {canStartReview ? (
          <Button variant="outline" className="border-white/15 text-zinc-200 hover:bg-white/10" onClick={handleStartReview} disabled={isStartingReview}>
            {isStartingReview ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Iniciar análise
          </Button>
        ) : null}
        {canDecide ? (
          <>
            <Button onClick={() => openDecisionDialog("approve")}>Aprovar</Button>
            <Button
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => openDecisionDialog("reject")}
            >
              Rejeitar
            </Button>
          </>
        ) : null}
      </div>

      <Dialog open={decisionDialog !== null} onOpenChange={(open) => !open && setDecisionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decisionDialog === "approve" ? "Aprovar reivindicação" : "Rejeitar reivindicação"}</DialogTitle>
            <DialogDescription>
              {decisionDialog === "approve"
                ? "A aprovação criará acesso administrativo para o solicitante nesta empresa."
                : "A solicitação permanecerá registrada e nenhum acesso será concedido."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="review-note">Justificativa administrativa (obrigatória)</Label>
              <Textarea
                id="review-note"
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Descreva como a representação legal foi confirmada, ou o motivo da rejeição."
                rows={4}
                disabled={isSubmittingDecision}
                aria-describedby="review-note-hint"
              />
              <p id="review-note-hint" className="text-xs text-zinc-500">
                Mínimo de {REVIEW_NOTE_MIN} caracteres. Nunca inclua senha, token ou dados sensíveis desnecessários.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="verification-method">Método de verificação (opcional)</Label>
              <Select
                value={verificationMethod}
                onValueChange={(value) => setVerificationMethod(value ?? undefined)}
                disabled={isSubmittingDecision}
              >
                <SelectTrigger id="verification-method">
                  <SelectValue placeholder="Selecione, se aplicável" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VERIFICATION_METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionDialog(null)} disabled={isSubmittingDecision}>
              Cancelar
            </Button>
            <Button
              onClick={handleDecisionSubmit}
              disabled={isSubmittingDecision || reviewNote.trim().length < REVIEW_NOTE_MIN}
              className={decisionDialog === "reject" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            >
              {isSubmittingDecision ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {decisionDialog === "approve" ? "Confirmar aprovação" : "Confirmar rejeição"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
