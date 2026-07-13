import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepStatus = "complete" | "current" | "upcoming" | "blocked";

export type StepDefinition = {
  id: string;
  label: string;
  status: StepStatus;
};

/**
 * Indicador visual de etapas de um wizard — genérico (Sprint Demo Comercial
 * — Wizard de Nova Entrega, Parte 7/17). Não sabia nada de "entrega": só
 * recebe a lista de etapas já com o status calculado por quem chama.
 *
 * Acessibilidade: `aria-current="step"` na etapa atual (nunca comunicada só
 * por cor); cada etapa é um botão nomeado quando clicável, `disabled` com
 * `aria-disabled` quando bloqueada (etapa futura sem dados válidos ainda).
 */
export function Stepper({
  steps,
  onStepClick,
  className,
}: {
  steps: StepDefinition[];
  onStepClick?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start gap-2 sm:gap-4", className)} aria-label="Etapas da entrega">
      {steps.map((step, index) => {
        const clickable = Boolean(onStepClick) && step.status !== "blocked";
        const circleClassName = cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
          step.status === "complete" && "border-primary bg-primary text-primary-foreground",
          step.status === "current" && "border-primary text-primary",
          step.status === "upcoming" && "border-border text-muted-foreground",
          step.status === "blocked" && "border-border text-muted-foreground/50",
        );

        const content = (
          <span className="flex items-center gap-2">
            <span className={circleClassName} aria-hidden="true">
              {step.status === "complete" ? <CheckIcon className="size-3.5" /> : index + 1}
            </span>
            <span className="grid text-left">
              <span
                className={cn(
                  "text-sm font-medium",
                  step.status === "upcoming" || step.status === "blocked" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {step.status === "complete"
                  ? "Concluída"
                  : step.status === "current"
                    ? "Etapa atual"
                    : step.status === "blocked"
                      ? "Bloqueada"
                      : "Pendente"}
              </span>
            </span>
          </span>
        );

        return (
          <li key={step.id} className="flex-1" aria-current={step.status === "current" ? "step" : undefined}>
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick?.(index)}
                className="w-full cursor-pointer rounded-lg p-1 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {content}
              </button>
            ) : (
              <div
                className="w-full p-1"
                aria-disabled={step.status === "blocked" || undefined}
              >
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
