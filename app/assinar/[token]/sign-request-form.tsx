"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/custody/signature-pad";

export function SignRequestForm({ token, employeeName }: { token: string; employeeName: string }) {
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigned, setIsSigned] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    if (!signatureData) {
      setFormError("Assine no campo acima antes de confirmar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/signature-requests/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível registrar a assinatura.");
        return;
      }

      setIsSigned(true);
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSigned) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
        Assinatura registrada com sucesso. Obrigado, {employeeName}!
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      <div className="grid gap-2">
        <Label>Assinatura de {employeeName}</Label>
        <SignaturePad onChange={setSignatureData} disabled={isSubmitting} />
      </div>
      <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
        Confirmar assinatura
      </Button>
    </div>
  );
}
