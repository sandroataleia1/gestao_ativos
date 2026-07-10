"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CompanyTrainingOption } from "./types";

const STEPS = ["Treinamento", "Data", "Local", "Instrutor", "Capacidade"] as const;

type FormValues = {
  companyTrainingId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  internalInstructor: string;
  externalInstructor: string;
  maximumParticipants: string;
  notes: string;
};

const EMPTY_VALUES: FormValues = {
  companyTrainingId: "",
  title: "",
  startsAt: "",
  endsAt: "",
  location: "",
  internalInstructor: "",
  externalInstructor: "",
  maximumParticipants: "",
  notes: "",
};

export function TrainingClassWizard({ companyTrainings }: { companyTrainings: CompanyTrainingOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [titleTouched, setTitleTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleTrainingChange(id: string) {
    const training = companyTrainings.find((t) => t.id === id);
    setValues((prev) => ({
      ...prev,
      companyTrainingId: id,
      title: !titleTouched && training ? training.title : prev.title,
    }));
  }

  const canAdvance =
    step === 0
      ? Boolean(values.companyTrainingId && values.title.trim())
      : step === 1
        ? Boolean(values.startsAt) && (!values.endsAt || values.endsAt >= values.startsAt)
        : true;

  function goNext() {
    if (!canAdvance) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canAdvance) return;
    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      companyTrainingId: values.companyTrainingId,
      title: values.title,
      startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : undefined,
      endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : undefined,
      location: values.location,
      internalInstructor: values.internalInstructor,
      externalInstructor: values.externalInstructor,
      maximumParticipants: values.maximumParticipants,
      notes: values.notes,
    };

    try {
      const response = await fetch("/api/training-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) setFieldErrors(data.fieldErrors);
        setFormError(data?.error ?? "Não foi possível criar a turma.");
        return;
      }

      toast.success("Turma criada.");
      router.push("/trainings/classes");
      router.refresh();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedTraining = companyTrainings.find((t) => t.id === values.companyTrainingId) ?? null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova turma</h1>
        <p className="text-sm text-muted-foreground">
          Passo {step + 1} de {STEPS.length} — {STEPS[step]}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid max-w-2xl gap-6">
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

        {step === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Treinamento</CardTitle>
              <CardDescription>Escolha o treinamento que esta turma vai executar.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Treinamento</Label>
                <Select
                  items={Object.fromEntries(companyTrainings.map((t) => [t.id, t.title]))}
                  value={values.companyTrainingId}
                  onValueChange={(value) => handleTrainingChange(value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {companyTrainings.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.companyTrainingId ? (
                  <p className="text-sm text-destructive">{fieldErrors.companyTrainingId[0]}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="class-title">Título da turma</Label>
                <Input
                  id="class-title"
                  placeholder="Ex.: Turma NR-35 — Julho/2026"
                  value={values.title}
                  onChange={(event) => {
                    setTitleTouched(true);
                    setField("title", event.target.value);
                  }}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.title)}
                />
                {fieldErrors.title ? (
                  <p className="text-sm text-destructive">{fieldErrors.title[0]}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Data</CardTitle>
              <CardDescription>Quando a turma começa e termina.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="class-startsAt">Início</Label>
                <Input
                  id="class-startsAt"
                  type="datetime-local"
                  value={values.startsAt}
                  onChange={(event) => setField("startsAt", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.startsAt)}
                />
                {fieldErrors.startsAt ? (
                  <p className="text-sm text-destructive">{fieldErrors.startsAt[0]}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="class-endsAt">Término</Label>
                <Input
                  id="class-endsAt"
                  type="datetime-local"
                  value={values.endsAt}
                  onChange={(event) => setField("endsAt", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.endsAt)}
                />
                {fieldErrors.endsAt ? (
                  <p className="text-sm text-destructive">{fieldErrors.endsAt[0]}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Opcional.</p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card>
            <CardHeader>
              <CardTitle>Local</CardTitle>
              <CardDescription>Onde a turma vai acontecer.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Label htmlFor="class-location">Local</Label>
              <Input
                id="class-location"
                placeholder="Ex.: Sala de treinamento, Obra X..."
                value={values.location}
                onChange={(event) => setField("location", event.target.value)}
                disabled={isSubmitting}
              />
            </CardContent>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card>
            <CardHeader>
              <CardTitle>Instrutor</CardTitle>
              <CardDescription>Preencha o instrutor interno e/ou externo responsável.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="class-internalInstructor">Instrutor interno</Label>
                <Input
                  id="class-internalInstructor"
                  value={values.internalInstructor}
                  onChange={(event) => setField("internalInstructor", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="class-externalInstructor">Instrutor externo</Label>
                <Input
                  id="class-externalInstructor"
                  value={values.externalInstructor}
                  onChange={(event) => setField("externalInstructor", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 4 ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Capacidade</CardTitle>
                <CardDescription>Número máximo de participantes e observações.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2 sm:max-w-[calc(50%-0.5rem)]">
                  <Label htmlFor="class-maximumParticipants">Máximo de participantes</Label>
                  <Input
                    id="class-maximumParticipants"
                    type="number"
                    min={1}
                    value={values.maximumParticipants}
                    onChange={(event) => setField("maximumParticipants", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="class-notes">Observações</Label>
                  <Textarea
                    id="class-notes"
                    rows={3}
                    value={values.notes}
                    onChange={(event) => setField("notes", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revisão</CardTitle>
                <CardDescription>Confira antes de salvar.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <p><span className="text-muted-foreground">Treinamento:</span> {selectedTraining?.title ?? "—"}</p>
                <p><span className="text-muted-foreground">Turma:</span> {values.title || "—"}</p>
                <p><span className="text-muted-foreground">Início:</span> {values.startsAt || "—"}</p>
                <p><span className="text-muted-foreground">Término:</span> {values.endsAt || "—"}</p>
                <p><span className="text-muted-foreground">Local:</span> {values.location || "—"}</p>
              </CardContent>
            </Card>
          </>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={goBack} disabled={step === 0 || isSubmitting}>
            <ArrowLeftIcon />
            Voltar
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext} disabled={!canAdvance || isSubmitting}>
              Avançar
              <ArrowRightIcon />
            </Button>
          ) : (
            <Button type="submit" disabled={!canAdvance || isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Salvar
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={isSubmitting} render={<Link href="/trainings/classes" />}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
