"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { focusFirstFieldWithError } from "@/lib/form-focus";
import type { TrainingClass } from "@/app/generated/prisma/client";
import type { CompanyTrainingOption } from "./types";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

function toDateTimeInputValue(date: Date | string | null) {
  if (!date) return "";
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type FormValues = {
  companyTrainingId: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  location: string;
  internalInstructor: string;
  externalInstructor: string;
  maximumParticipants: string;
  notes: string;
};

function toFormValues(trainingClass: TrainingClass): FormValues {
  return {
    companyTrainingId: trainingClass.companyTrainingId,
    title: trainingClass.title,
    status: trainingClass.status,
    startsAt: toDateTimeInputValue(trainingClass.startsAt),
    endsAt: toDateTimeInputValue(trainingClass.endsAt),
    location: trainingClass.location ?? "",
    internalInstructor: trainingClass.internalInstructor ?? "",
    externalInstructor: trainingClass.externalInstructor ?? "",
    maximumParticipants: trainingClass.maximumParticipants?.toString() ?? "",
    notes: trainingClass.notes ?? "",
  };
}

export function TrainingClassEditForm({
  trainingClass,
  companyTrainings,
}: {
  trainingClass: TrainingClass;
  companyTrainings: CompanyTrainingOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => toFormValues(trainingClass));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      companyTrainingId: values.companyTrainingId,
      title: values.title,
      status: values.status,
      startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : undefined,
      endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : undefined,
      location: values.location,
      internalInstructor: values.internalInstructor,
      externalInstructor: values.externalInstructor,
      maximumParticipants: values.maximumParticipants,
      notes: values.notes,
    };

    try {
      const response = await fetch(`/api/training-classes/${trainingClass.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(
            data.fieldErrors,
            ["title", "startsAt", "endsAt"],
            (key) => `class-${key}`,
          );
        }
        setFormError(data?.error ?? "Não foi possível salvar a turma.");
        return;
      }

      toast.success("Turma atualizada.");
      router.push("/trainings/classes");
      router.refresh();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Editar turma</h1>
        <p className="text-sm text-muted-foreground">Atualize os dados ou o status da turma.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <div className="grid gap-2">
              <Label>Treinamento</Label>
              <Select
                items={Object.fromEntries(companyTrainings.map((t) => [t.id, t.title]))}
                value={values.companyTrainingId}
                onValueChange={(value) => setField("companyTrainingId", value as string)}
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
            </div>

            <div className="grid gap-2">
              <Label htmlFor="class-title">Título da turma</Label>
              <Input
                id="class-title"
                value={values.title}
                onChange={(event) => setField("title", event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.title)}
              />
              {fieldErrors.title ? (
                <p className="text-sm text-destructive">{fieldErrors.title[0]}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                items={STATUS_LABELS}
                value={values.status}
                onValueChange={(value) => setField("status", value as string)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                ) : null}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="class-location">Local</Label>
              <Input
                id="class-location"
                value={values.location}
                onChange={(event) => setField("location", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            </div>

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

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                Salvar alterações
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                render={<Link href="/trainings/classes" />}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
