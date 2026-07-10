"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { focusFirstFieldWithError } from "@/lib/form-focus";

type TrainingOption = { id: string; title: string };

// Formulário de turma em página única, deliberadamente mais simples que o
// wizard de 5 passos do Portal Empresa — alinhado à seção 11 do requisito
// ("demonstração em menos de 3 minutos", evitar excesso de passos). Só
// treinamentos gerenciados por esta consultoria aparecem no seletor (ver
// docs/portal-consultoria.md).
export function SstClassForm({
  companyId,
  trainings,
  defaultCompanyTrainingId,
}: {
  companyId: string;
  trainings: TrainingOption[];
  defaultCompanyTrainingId?: string;
}) {
  const router = useRouter();
  const [companyTrainingId, setCompanyTrainingId] = useState(defaultCompanyTrainingId ?? "");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [internalInstructor, setInternalInstructor] = useState("");
  const [externalInstructor, setExternalInstructor] = useState("");
  const [maximumParticipants, setMaximumParticipants] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      companyTrainingId,
      title,
      startsAt,
      endsAt: endsAt || undefined,
      location,
      internalInstructor,
      externalInstructor,
      maximumParticipants,
      notes,
    };

    try {
      const response = await fetch(`/api/sst/companies/${companyId}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(data.fieldErrors, ["companyTrainingId", "title", "startsAt"], (key) => `class-${key}`);
        }
        setFormError(data?.error ?? "Não foi possível criar a turma.");
        return;
      }

      const data = await response.json();
      router.push(`/sst/companies/${companyId}/classes/${data.trainingClass.id}`);
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
        <h1 className="text-2xl font-semibold">Nova turma</h1>
        <p className="text-sm text-muted-foreground">Agende uma turma para um treinamento gerenciado por sua consultoria.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-2">
              <Label>Treinamento</Label>
              {trainings.length ? (
                <Select
                  items={Object.fromEntries(trainings.map((t) => [t.id, t.title]))}
                  value={companyTrainingId}
                  onValueChange={(value) => setCompanyTrainingId(value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o treinamento" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainings.map((training) => (
                      <SelectItem key={training.id} value={training.id}>
                        {training.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum treinamento gerenciado por sua consultoria ainda. Crie um treinamento primeiro.
                </p>
              )}
              {fieldErrors.companyTrainingId ? (
                <p className="text-sm text-destructive">{fieldErrors.companyTrainingId[0]}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="class-title">Título da turma</Label>
              <Input
                id="class-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.title)}
              />
              {fieldErrors.title ? <p className="text-sm text-destructive">{fieldErrors.title[0]}</p> : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="class-startsAt">Início</Label>
                <Input
                  id="class-startsAt"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.startsAt)}
                />
                {fieldErrors.startsAt ? <p className="text-sm text-destructive">{fieldErrors.startsAt[0]}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="class-endsAt">Término (opcional)</Label>
                <Input
                  id="class-endsAt"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.endsAt)}
                />
                {fieldErrors.endsAt ? <p className="text-sm text-destructive">{fieldErrors.endsAt[0]}</p> : null}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="class-location">Local</Label>
              <Input id="class-location" value={location} onChange={(event) => setLocation(event.target.value)} disabled={isSubmitting} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="class-internalInstructor">Instrutor interno</Label>
                <Input
                  id="class-internalInstructor"
                  value={internalInstructor}
                  onChange={(event) => setInternalInstructor(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="class-externalInstructor">Instrutor externo</Label>
                <Input
                  id="class-externalInstructor"
                  value={externalInstructor}
                  onChange={(event) => setExternalInstructor(event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:max-w-[calc(50%-0.5rem)]">
              <Label htmlFor="class-maximumParticipants">Capacidade máxima (opcional)</Label>
              <Input
                id="class-maximumParticipants"
                type="number"
                min={1}
                value={maximumParticipants}
                onChange={(event) => setMaximumParticipants(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="class-notes">Observações</Label>
              <Textarea id="class-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isSubmitting} />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting || !companyTrainingId}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                Criar turma
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                render={<Link href={`/sst/companies/${companyId}/classes`} />}
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
