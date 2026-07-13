"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
import { Stepper, type StepDefinition } from "@/components/ui/stepper";
import type { AssetBalanceMap, AssetOption, AssetUnitOption, EmployeeOption } from "../types";
import { StepEmployee } from "./step-employee";
import { StepItem } from "./step-item";
import { StepConfirm } from "./step-confirm";
import { DeliverySummaryPanel } from "./delivery-summary-panel";
import { DeliverySuccessPanel } from "./delivery-success-panel";
import {
  buildDeliverPayload,
  buildDeliverySummary,
  getItemStepErrors,
  initialWizardValues,
  isEmployeeStepValid,
  isItemStepValid,
  type SignatureMode,
  type WizardValues,
} from "./wizard-logic";

const STEP_LABELS = ["Colaborador", "Item e entrega", "Termo e confirmação"];

type SubmitResult = { signUrl: string | null; whatsappWarning: string | null };

export function DeliveryWizard({
  employees,
  assets,
  availableUnits,
  balanceByAsset,
  whatsappConfigured,
}: {
  employees: EmployeeOption[];
  assets: AssetOption[];
  availableUnits: AssetUnitOption[];
  balanceByAsset: AssetBalanceMap;
  whatsappConfigured: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0-indexed
  const [employee, setEmployee] = useState<EmployeeOption | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [values, setValues] = useState<WizardValues>(() => initialWizardValues());
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const stepHeadingRef = useRef<HTMLDivElement | null>(null);
  const quantityFieldRef = useRef<HTMLInputElement | null>(null);

  const selectedAsset = useMemo(() => assets.find((a) => a.id === values.assetId) ?? null, [assets, values.assetId]);
  const unitsForAsset = useMemo(
    () => availableUnits.filter((unit) => unit.assetId === values.assetId),
    [availableUnits, values.assetId],
  );

  const step1Valid = isEmployeeStepValid(employee);
  const itemStepErrors = getItemStepErrors(values, selectedAsset, balanceByAsset, unitsForAsset);
  const step2Valid = isItemStepValid(values, selectedAsset, balanceByAsset, unitsForAsset);

  const summary = employee ? buildDeliverySummary(values, employee, selectedAsset, unitsForAsset) : null;

  const hasMeaningfulData = Boolean(employee || values.assetId || values.notes.trim() || values.photos.length);

  // Uma nova tentativa de confirmação (dados diferentes) precisa de uma
  // chave de idempotência nova — só o duplo clique/retry da MESMA
  // submissão deve reaproveitar a chave (ver lib/idempotency.ts).
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [employee?.id, values.assetId, values.assetUnitId, values.quantity]);

  useEffect(() => {
    if (!hasMeaningfulData || result) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasMeaningfulData, result]);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  function setField<K extends keyof WizardValues>(key: K, value: WizardValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleAssetChange(assetId: string) {
    const nextAsset = assets.find((a) => a.id === assetId) ?? null;
    // Trocar de ativo só limpa os campos incompatíveis com o novo modo de
    // controle (Parte 8) — nunca zera data/observação/fotos, que continuam
    // válidas independente do ativo escolhido.
    setValues((prev) => ({
      ...prev,
      assetId,
      assetUnitId: "",
      quantity: "",
      expectedReturnAt: nextAsset?.trackingMode === "INDIVIDUAL" ? prev.expectedReturnAt : "",
    }));
  }

  function goToStep(index: number) {
    if (index === 1 && !step1Valid) return;
    if (index === 2 && !(step1Valid && step2Valid)) return;
    setStep(index);
  }

  function handleContinue() {
    if (step === 0) {
      if (!step1Valid) return;
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!step2Valid) {
        // Foco no primeiro campo inválido (Parte 17).
        quantityFieldRef.current?.focus();
        return;
      }
      setStep(2);
    }
  }

  function handleCancelClick() {
    if (hasMeaningfulData && !result) {
      setShowDiscardDialog(true);
      return;
    }
    router.push("/custodies");
  }

  function resetWizard() {
    setEmployee(null);
    setEmployeeQuery("");
    setValues(initialWizardValues());
    setStep(0);
    setSubmitError(null);
    setResult(null);
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  async function handleConfirm() {
    if (!employee || !selectedAsset || isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const payload = buildDeliverPayload(values, employee, selectedAsset);
      const response = await fetch("/api/custodies/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKeyRef.current },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setSubmitError(data?.error ?? "Não foi possível registrar a entrega. Revise os dados e tente novamente.");
        return;
      }

      const data = await response.json().catch(() => null);
      setResult({ signUrl: data?.signUrl ?? null, whatsappWarning: data?.whatsappWarning ?? null });
      router.refresh();
    } catch {
      setSubmitError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const steps: StepDefinition[] = STEP_LABELS.map((label, index) => {
    let status: StepDefinition["status"] = "upcoming";
    if (result) {
      status = index <= 2 ? "complete" : "upcoming";
    } else if (index === step) {
      status = "current";
    } else if (index < step) {
      status = "complete";
    } else if (index === 1 && !step1Valid) {
      status = "blocked";
    } else if (index === 2 && !(step1Valid && step2Valid)) {
      status = "blocked";
    }
    return { id: label, label, status };
  });

  return (
    <div className="grid gap-6">
      <div ref={stepHeadingRef} tabIndex={-1} className="outline-none">
        <h1 className="text-2xl font-semibold">Nova entrega</h1>
      </div>

      <Stepper steps={steps} onStepClick={result ? undefined : goToStep} />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="grid gap-6">
          {result && summary ? (
            <DeliverySuccessPanel
              summary={summary}
              signUrl={result.signUrl}
              whatsappWarning={result.whatsappWarning}
              onRegisterAnother={resetWizard}
            />
          ) : (
            <>
              {step === 0 ? (
                <StepEmployee
                  employees={employees}
                  selectedEmployee={employee}
                  onSelect={setEmployee}
                  query={employeeQuery}
                  onQueryChange={setEmployeeQuery}
                />
              ) : null}

              {step === 1 ? (
                <StepItem
                  assets={assets}
                  selectedAsset={selectedAsset}
                  unitsForAsset={unitsForAsset}
                  balanceByAsset={balanceByAsset}
                  values={values}
                  errors={itemStepErrors}
                  onAssetChange={handleAssetChange}
                  onFieldChange={setField}
                  firstErrorFieldRef={quantityFieldRef}
                />
              ) : null}

              {step === 2 && employee && selectedAsset && summary ? (
                <StepConfirm
                  summary={summary}
                  employee={employee}
                  signatureMode={values.signatureMode}
                  onSignatureModeChange={(mode: SignatureMode) => setField("signatureMode", mode)}
                  whatsappConfigured={whatsappConfigured}
                  isSubmitting={isSubmitting}
                  submitError={submitError}
                  onConfirm={handleConfirm}
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                {step > 0 ? (
                  <Button type="button" variant="outline" onClick={() => setStep(step - 1)} disabled={isSubmitting}>
                    Voltar
                  </Button>
                ) : null}
                {step < 2 ? (
                  <Button
                    type="button"
                    onClick={handleContinue}
                    disabled={step === 0 ? !step1Valid : !step2Valid}
                  >
                    Continuar
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={handleCancelClick} disabled={isSubmitting}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </div>

        {!result && summary ? (
          <div className="hidden lg:block">
            <DeliverySummaryPanel summary={summary} />
          </div>
        ) : null}
      </div>

      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta entrega?</AlertDialogTitle>
            <AlertDialogDescription>
              Os dados preenchidos até agora serão perdidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar preenchendo</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setShowDiscardDialog(false);
                router.push("/custodies");
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
