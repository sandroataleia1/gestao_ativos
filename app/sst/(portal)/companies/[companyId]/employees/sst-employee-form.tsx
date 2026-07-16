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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { maskBrazilianPhone, maskCPF } from "@/lib/masks";
import { focusFirstFieldWithError } from "@/lib/form-focus";

// Sprint SST 1.4F — formulário de colaborador do Portal Consultoria.
// Deliberadamente um componente PRÓPRIO (não o EmployeeForm do Portal
// Empresa, app/(app)/employees/employee-form.tsx): aquele usa
// QuickCreateLookupDialog contra /api/departments e /api/positions, rotas
// protegidas por requirePermission() (RBAC do Portal Empresa) — a sessão da
// consultoria nunca passa por esse guard, então "criar departamento/cargo
// inline" não é seguro de reaproveitar aqui (§12 do spec: "permitir apenas
// seleção" é a opção escolhida quando a criação inline ampliaria o escopo).
// Os MESMOS campos/validações do Employee são reaproveitados (mesma
// máscara de documento, mesmo schema employeeInputSchema no backend).

const NONE_VALUE = "none";

type LookupOption = { id: string; name: string };

type FormValues = {
  name: string;
  document: string;
  email: string;
  phone: string;
  registration: string;
  departmentId: string;
  positionId: string;
  status: "ACTIVE" | "INACTIVE";
};

type EditableEmployee = {
  id: string;
  name: string;
  document: string;
  email: string | null;
  phone: string | null;
  registration: string | null;
  departmentId: string | null;
  positionId: string | null;
  status: "ACTIVE" | "INACTIVE";
};

function toFormValues(employee: EditableEmployee | null): FormValues {
  if (!employee) {
    return { name: "", document: "", email: "", phone: "", registration: "", departmentId: NONE_VALUE, positionId: NONE_VALUE, status: "ACTIVE" };
  }
  return {
    name: employee.name,
    document: employee.document,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    registration: employee.registration ?? "",
    departmentId: employee.departmentId ?? NONE_VALUE,
    positionId: employee.positionId ?? NONE_VALUE,
    status: employee.status,
  };
}

export function SstEmployeeForm({
  companyId,
  employee,
  departments,
  positions,
}: {
  companyId: string;
  employee: EditableEmployee | null;
  departments: LookupOption[];
  positions: LookupOption[];
}) {
  const router = useRouter();
  const isEditing = Boolean(employee);
  const listHref = `/sst/companies/${companyId}/employees`;
  const [values, setValues] = useState<FormValues>(() => toFormValues(employee));
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
      name: values.name,
      document: values.document,
      email: values.email,
      phone: values.phone,
      registration: values.registration,
      departmentId: values.departmentId === NONE_VALUE ? "" : values.departmentId,
      positionId: values.positionId === NONE_VALUE ? "" : values.positionId,
      status: values.status,
    };

    try {
      const response = await fetch(
        isEditing ? `/api/sst/companies/${companyId}/employees/${employee!.id}` : `/api/sst/companies/${companyId}/employees`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(data.fieldErrors, ["name", "document", "email"], (key) => `sst-employee-${key}`);
        }
        setFormError(data?.error ?? "Não foi possível salvar o colaborador.");
        return;
      }

      toast.success(isEditing ? "Colaborador atualizado." : "Colaborador cadastrado com sucesso.");
      router.push(listHref);
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
        <h1 className="text-2xl font-semibold">{isEditing ? "Editar colaborador" : "Novo colaborador"}</h1>
        <p className="text-sm text-muted-foreground">
          {isEditing ? "Atualize os dados do colaborador." : "Preencha os dados para cadastrar um novo colaborador."}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <div className="grid gap-2">
              <Label htmlFor="sst-employee-name">Nome</Label>
              <Input
                id="sst-employee-name"
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? "sst-employee-name-error" : undefined}
              />
              {fieldErrors.name ? (
                <p id="sst-employee-name-error" className="text-sm text-destructive">
                  {fieldErrors.name[0]}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sst-employee-document">Documento</Label>
              <Input
                id="sst-employee-document"
                placeholder="000.000.000-00"
                value={values.document}
                onChange={(event) => setField("document", maskCPF(event.target.value))}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.document)}
                aria-describedby={fieldErrors.document ? "sst-employee-document-error" : undefined}
              />
              {fieldErrors.document ? (
                <p id="sst-employee-document-error" className="text-sm text-destructive">
                  {fieldErrors.document[0]}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sst-employee-email">Email</Label>
                <Input
                  id="sst-employee-email"
                  type="email"
                  value={values.email}
                  onChange={(event) => setField("email", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "sst-employee-email-error" : undefined}
                />
                {fieldErrors.email ? (
                  <p id="sst-employee-email-error" className="text-sm text-destructive">
                    {fieldErrors.email[0]}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sst-employee-phone">Telefone</Label>
                <Input
                  id="sst-employee-phone"
                  placeholder="(00) 00000-0000"
                  value={values.phone}
                  onChange={(event) => setField("phone", maskBrazilianPhone(event.target.value))}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sst-employee-registration">Matrícula</Label>
              <Input
                id="sst-employee-registration"
                placeholder="Ex.: 00123"
                value={values.registration}
                onChange={(event) => setField("registration", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Departamento</Label>
                <Select
                  items={{ [NONE_VALUE]: "Nenhum", ...Object.fromEntries(departments.map((d) => [d.id, d.name])) }}
                  value={values.departmentId}
                  onValueChange={(value) => setField("departmentId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {departments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum departamento cadastrado ainda — departamentos e cargos são cadastrados pelo Portal Empresa.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label>Cargo</Label>
                <Select
                  items={{ [NONE_VALUE]: "Nenhum", ...Object.fromEntries(positions.map((p) => [p.id, p.name])) }}
                  value={values.positionId}
                  onValueChange={(value) => setField("positionId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                    {positions.map((position) => (
                      <SelectItem key={position.id} value={position.id}>
                        {position.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {positions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum cargo cadastrado ainda — departamentos e cargos são cadastrados pelo Portal Empresa.
                  </p>
                ) : null}
              </div>
            </div>

            {isEditing ? (
              <div className="grid gap-2">
                <Label>Situação</Label>
                <Select
                  items={{ ACTIVE: "Ativo", INACTIVE: "Inativo" }}
                  value={values.status}
                  onValueChange={(value) => setField("status", value as FormValues["status"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {isEditing ? "Salvar alterações" : "Criar colaborador"}
              </Button>
              <Button type="button" variant="outline" disabled={isSubmitting} render={<Link href={listHref} />}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
