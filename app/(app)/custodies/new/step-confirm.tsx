"use client";

import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EmployeeOption } from "../types";
import { isSignatureModeAvailable, type DeliverySummary, type SignatureMode } from "./wizard-logic";

const SIGNATURE_OPTIONS: { mode: SignatureMode; title: string; description: string }[] = [
  {
    mode: "QR",
    title: "QR Code presencial",
    description: "O colaborador escaneia o QR Code e assina pelo próprio celular.",
  },
  {
    mode: "WHATSAPP",
    title: "WhatsApp",
    description: "O sistema envia um link para o número configurado, quando a integração estiver disponível.",
  },
];

export function StepConfirm({
  summary,
  employee,
  signatureMode,
  onSignatureModeChange,
  whatsappConfigured,
  isSubmitting,
  submitError,
  onConfirm,
}: {
  summary: DeliverySummary;
  employee: EmployeeOption;
  signatureMode: SignatureMode;
  onSignatureModeChange: (mode: SignatureMode) => void;
  whatsappConfigured: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onConfirm: () => void;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Colaborador", value: summary.employeeName },
  ];
  if (summary.employeeRole) rows.push({ label: "Cargo e setor", value: summary.employeeRole });
  rows.push({ label: "Item", value: summary.itemLabel });
  if (summary.quantityOrSerial) rows.push({ label: "Quantidade / série", value: summary.quantityOrSerial });
  rows.push({ label: "Data e hora", value: summary.deliveredAtLabel });
  if (summary.expectedReturnLabel) rows.push({ label: "Previsão de devolução", value: summary.expectedReturnLabel });
  if (summary.notes) rows.push({ label: "Observação", value: summary.notes });
  rows.push({ label: "Fotos anexadas", value: String(summary.photoCount) });

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-medium">Termo e confirmação</h2>
        <p className="text-sm text-muted-foreground">
          Revise os dados, escolha a forma de assinatura e confirme a entrega.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium break-words">{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Como assinar</p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Método de assinatura">
          {SIGNATURE_OPTIONS.map((option) => {
            const available = isSignatureModeAvailable(option.mode, employee, whatsappConfigured);
            const selected = signatureMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!available || isSubmitting}
                onClick={() => onSignatureModeChange(option.mode)}
                className="grid gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-primary aria-checked:bg-primary/5 not-aria-checked:hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="text-sm font-medium">{option.title}</span>
                <span className="text-xs text-muted-foreground">
                  {available
                    ? option.description
                    : option.mode === "WHATSAPP"
                      ? !whatsappConfigured
                        ? "Integração de WhatsApp não configurada para esta empresa."
                        : "Colaborador não tem WhatsApp cadastrado."
                      : option.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Button type="button" onClick={onConfirm} disabled={isSubmitting} className="w-fit">
          {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Confirmar entrega e gerar termo
        </Button>
        <p className="text-xs text-muted-foreground">
          A entrega será registrada, o estoque ou a disponibilidade do item será atualizado, a custódia será
          criada, o termo será gerado e o próximo passo de assinatura começará conforme o método escolhido.
        </p>
      </div>
    </div>
  );
}
