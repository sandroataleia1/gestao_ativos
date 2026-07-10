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

const CUSTOM_VALUE = "custom";

const TRAINING_TYPE_LABELS: Record<string, string> = { LEGAL: "Legal", CORPORATE: "Corporativo" };
const INSTRUCTOR_TYPE_LABELS: Record<string, string> = { INTERNAL: "Interno", EXTERNAL: "Externo", BOTH: "Ambos" };
const BOOLEAN_LABELS = { true: "Sim", false: "Não" };

type TemplateOption = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  trainingType: "LEGAL" | "CORPORATE";
  nrReference: string | null;
  defaultValidityMonths: number | null;
  defaultWorkloadHours: number | null;
  requiresCertificate: boolean;
  requiresAttendanceList: boolean;
  requiresSignature: boolean;
  requiresExam: boolean;
  minimumPassingGrade: number | null;
  defaultInstructorType: "INTERNAL" | "EXTERNAL" | "BOTH";
};

type TrainingRecord = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  trainingType: "LEGAL" | "CORPORATE";
  nrReference: string | null;
  validityMonths: number | null;
  workloadHours: number | null;
  requiresCertificate: boolean;
  requiresAttendanceList: boolean;
  requiresSignature: boolean;
  requiresExam: boolean;
  minimumPassingGrade: number | null;
  instructorType: "INTERNAL" | "EXTERNAL" | "BOTH";
  mandatory: boolean;
  active: boolean;
};

type FormValues = {
  title: string;
  description: string;
  category: string;
  trainingType: "LEGAL" | "CORPORATE";
  nrReference: string;
  validityMonths: string;
  workloadHours: string;
  requiresCertificate: "true" | "false";
  requiresAttendanceList: "true" | "false";
  requiresSignature: "true" | "false";
  requiresExam: "true" | "false";
  minimumPassingGrade: string;
  instructorType: "INTERNAL" | "EXTERNAL" | "BOTH";
  mandatory: "true" | "false";
  active: "true" | "false";
};

function toFormValues(training: TrainingRecord | null): FormValues {
  if (!training) {
    return {
      title: "",
      description: "",
      category: "",
      trainingType: "LEGAL",
      nrReference: "",
      validityMonths: "",
      workloadHours: "",
      requiresCertificate: "true",
      requiresAttendanceList: "true",
      requiresSignature: "false",
      requiresExam: "false",
      minimumPassingGrade: "",
      instructorType: "BOTH",
      mandatory: "false",
      active: "true",
    };
  }
  return {
    title: training.title,
    description: training.description ?? "",
    category: training.category ?? "",
    trainingType: training.trainingType,
    nrReference: training.nrReference ?? "",
    validityMonths: training.validityMonths?.toString() ?? "",
    workloadHours: training.workloadHours?.toString() ?? "",
    requiresCertificate: training.requiresCertificate ? "true" : "false",
    requiresAttendanceList: training.requiresAttendanceList ? "true" : "false",
    requiresSignature: training.requiresSignature ? "true" : "false",
    requiresExam: training.requiresExam ? "true" : "false",
    minimumPassingGrade: training.minimumPassingGrade?.toString() ?? "",
    instructorType: training.instructorType,
    mandatory: training.mandatory ? "true" : "false",
    active: training.active ? "true" : "false",
  };
}

function templateToFormValues(template: TemplateOption): Omit<FormValues, "active" | "mandatory"> {
  return {
    title: template.title,
    description: template.description ?? "",
    category: template.category,
    trainingType: template.trainingType,
    nrReference: template.nrReference ?? "",
    validityMonths: template.defaultValidityMonths?.toString() ?? "",
    workloadHours: template.defaultWorkloadHours?.toString() ?? "",
    requiresCertificate: template.requiresCertificate ? "true" : "false",
    requiresAttendanceList: template.requiresAttendanceList ? "true" : "false",
    requiresSignature: template.requiresSignature ? "true" : "false",
    requiresExam: template.requiresExam ? "true" : "false",
    minimumPassingGrade: template.minimumPassingGrade?.toString() ?? "",
    instructorType: template.defaultInstructorType,
  };
}

// Formulário enxuto do Portal Consultoria — sem seletor de gestão/prestador
// (managementMode/managedByProviderId são sempre forçados pelo servidor
// para EXTERNAL_PROVIDER + o provider da sessão, nunca escolhidos aqui, ver
// app/api/sst/companies/[companyId]/trainings/route.ts).
export function SstTrainingForm({
  companyId,
  training,
  templates,
}: {
  companyId: string;
  training: TrainingRecord | null;
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const isEditing = Boolean(training);
  const [templateId, setTemplateId] = useState(CUSTOM_VALUE);
  const [values, setValues] = useState<FormValues>(() => toFormValues(training));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleTemplateChange(value: string) {
    setTemplateId(value);
    if (value === CUSTOM_VALUE) return;
    const template = templates.find((t) => t.id === value);
    if (!template) return;
    setValues((prev) => ({ ...prev, ...templateToFormValues(template) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      ...(isEditing ? {} : { trainingTemplateId: templateId === CUSTOM_VALUE ? "" : templateId }),
      title: values.title,
      description: values.description,
      category: values.category,
      trainingType: values.trainingType,
      nrReference: values.nrReference,
      validityMonths: values.validityMonths,
      workloadHours: values.workloadHours,
      requiresCertificate: values.requiresCertificate === "true",
      requiresAttendanceList: values.requiresAttendanceList === "true",
      requiresSignature: values.requiresSignature === "true",
      requiresExam: values.requiresExam === "true",
      minimumPassingGrade: values.minimumPassingGrade,
      instructorType: values.instructorType,
      mandatory: values.mandatory === "true",
      active: isEditing ? values.active === "true" : true,
    };

    try {
      const url = isEditing
        ? `/api/sst/companies/${companyId}/trainings/${training!.id}`
        : `/api/sst/companies/${companyId}/trainings`;
      const response = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(data.fieldErrors, ["title", "category", "trainingType"], (key) => `training-${key}`);
        }
        setFormError(data?.error ?? "Não foi possível salvar o treinamento.");
        return;
      }

      router.push(`/sst/companies/${companyId}/trainings`);
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
        <h1 className="text-2xl font-semibold">{isEditing ? "Editar treinamento" : "Novo treinamento"}</h1>
        <p className="text-sm text-muted-foreground">
          {isEditing
            ? "Atualize os dados do treinamento gerenciado por esta consultoria."
            : "O treinamento criado aqui fica marcado como gerenciado por esta consultoria."}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            {!isEditing ? (
              <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
                <Label>Modelo</Label>
                <Select
                  items={{
                    [CUSTOM_VALUE]: "Personalizado (em branco)",
                    ...Object.fromEntries(templates.map((t) => [t.id, t.title])),
                  }}
                  value={templateId}
                  onValueChange={(value) => handleTemplateChange(value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CUSTOM_VALUE}>Personalizado (em branco)</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="training-title">Título</Label>
              <Input
                id="training-title"
                value={values.title}
                onChange={(event) => setField("title", event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.title)}
              />
              {fieldErrors.title ? <p className="text-sm text-destructive">{fieldErrors.title[0]}</p> : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-description">Descrição</Label>
              <Textarea
                id="training-description"
                rows={3}
                value={values.description}
                onChange={(event) => setField("description", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="training-category">Categoria</Label>
                <Input
                  id="training-category"
                  value={values.category}
                  onChange={(event) => setField("category", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.category)}
                />
                {fieldErrors.category ? <p className="text-sm text-destructive">{fieldErrors.category[0]}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select
                  items={TRAINING_TYPE_LABELS}
                  value={values.trainingType}
                  onValueChange={(value) => setField("trainingType", value as FormValues["trainingType"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRAINING_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-nrReference">Referência NR</Label>
              <Input
                id="training-nrReference"
                placeholder="Ex.: NR-35"
                value={values.nrReference}
                onChange={(event) => setField("nrReference", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="training-validityMonths">Validade (meses)</Label>
                <Input
                  id="training-validityMonths"
                  type="number"
                  min={0}
                  value={values.validityMonths}
                  onChange={(event) => setField("validityMonths", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="training-workloadHours">Carga horária (h)</Label>
                <Input
                  id="training-workloadHours"
                  type="number"
                  min={0}
                  value={values.workloadHours}
                  onChange={(event) => setField("workloadHours", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Exige certificado</Label>
                <Select
                  items={BOOLEAN_LABELS}
                  value={values.requiresCertificate}
                  onValueChange={(value) => setField("requiresCertificate", value as FormValues["requiresCertificate"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Exige lista de presença</Label>
                <Select
                  items={BOOLEAN_LABELS}
                  value={values.requiresAttendanceList}
                  onValueChange={(value) => setField("requiresAttendanceList", value as FormValues["requiresAttendanceList"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Exige assinatura</Label>
                <Select
                  items={BOOLEAN_LABELS}
                  value={values.requiresSignature}
                  onValueChange={(value) => setField("requiresSignature", value as FormValues["requiresSignature"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Exige avaliação</Label>
                <Select
                  items={BOOLEAN_LABELS}
                  value={values.requiresExam}
                  onValueChange={(value) => setField("requiresExam", value as FormValues["requiresExam"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {values.requiresExam === "true" ? (
              <div className="grid gap-2 sm:max-w-[calc(50%-0.5rem)]">
                <Label htmlFor="training-minimumPassingGrade">Nota mínima</Label>
                <Input
                  id="training-minimumPassingGrade"
                  type="number"
                  min={0}
                  value={values.minimumPassingGrade}
                  onChange={(event) => setField("minimumPassingGrade", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Instrutor padrão</Label>
                <Select
                  items={INSTRUCTOR_TYPE_LABELS}
                  value={values.instructorType}
                  onValueChange={(value) => setField("instructorType", value as FormValues["instructorType"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INSTRUCTOR_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Obrigatório</Label>
                <Select
                  items={BOOLEAN_LABELS}
                  value={values.mandatory}
                  onValueChange={(value) => setField("mandatory", value as FormValues["mandatory"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isEditing ? (
              <div className="grid gap-2 sm:max-w-[calc(50%-0.5rem)]">
                <Label>Status do registro</Label>
                <Select
                  items={{ true: "Ativo", false: "Inativo" }}
                  value={values.active}
                  onValueChange={(value) => setField("active", value as FormValues["active"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Ativo</SelectItem>
                    <SelectItem value="false">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {isEditing ? "Salvar alterações" : "Criar treinamento"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                render={<Link href={`/sst/companies/${companyId}/trainings`} />}
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
