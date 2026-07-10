"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QuickCreateLookupDialog,
  type QuickCreateConfig,
} from "@/components/lookup/quick-create-lookup-dialog";
import { maskBrazilianPhone, maskCPF } from "@/lib/masks";
import { focusFirstFieldWithError } from "@/lib/form-focus";
import type { EmployeeRow, LookupOption } from "./types";

const NONE_VALUE = "none";

type QuickCreateFieldKey = "departmentId" | "positionId";
type LookupListKey = "departments" | "positions";

const QUICK_CREATE_MAP: Record<QuickCreateFieldKey, QuickCreateConfig & { listKey: LookupListKey }> = {
  departmentId: {
    title: "Departamento",
    apiBasePath: "/api/departments",
    nameField: "name",
    nameLabel: "Nome",
    responseKey: "department",
    listKey: "departments",
  },
  positionId: {
    title: "Cargo",
    apiBasePath: "/api/positions",
    nameField: "name",
    nameLabel: "Nome",
    responseKey: "position",
    listKey: "positions",
  },
};

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

function toFormValues(employee: EmployeeRow | null): FormValues {
  if (!employee) {
    return {
      name: "",
      document: "",
      email: "",
      phone: "",
      registration: "",
      departmentId: NONE_VALUE,
      positionId: NONE_VALUE,
      status: "ACTIVE",
    };
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

export function EmployeeForm({
  employee,
  departments,
  positions,
}: {
  employee: EmployeeRow | null;
  departments: LookupOption[];
  positions: LookupOption[];
}) {
  const router = useRouter();
  const isEditing = Boolean(employee);
  const [values, setValues] = useState<FormValues>(() => toFormValues(employee));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [extraOptions, setExtraOptions] = useState<Record<LookupListKey, LookupOption[]>>({
    departments: [],
    positions: [],
  });
  const [quickCreate, setQuickCreate] = useState<{
    field: QuickCreateFieldKey;
    config: QuickCreateConfig & { listKey: LookupListKey };
  } | null>(null);

  const allDepartments = useMemo(
    () => [...departments, ...extraOptions.departments],
    [departments, extraOptions.departments],
  );
  const allPositions = useMemo(
    () => [...positions, ...extraOptions.positions],
    [positions, extraOptions.positions],
  );

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleQuickCreated(option: LookupOption) {
    if (!quickCreate) return;
    const { field, config } = quickCreate;
    setExtraOptions((prev) => ({ ...prev, [config.listKey]: [...prev[config.listKey], option] }));
    setField(field, option.id);
    setQuickCreate(null);
  }

  function QuickCreateButton({ field, label }: { field: QuickCreateFieldKey; label: string }) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label={label}
              onClick={() => setQuickCreate({ field, config: QUICK_CREATE_MAP[field] })}
            >
              <PlusIcon className="size-4" />
              {QUICK_CREATE_MAP[field].title}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
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
        isEditing ? `/api/employees/${employee!.id}` : "/api/employees",
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
          focusFirstFieldWithError(
            data.fieldErrors,
            ["name", "document", "email"],
            (key) => `employee-${key}`,
          );
        }
        setFormError(data?.error ?? "Não foi possível salvar o colaborador.");
        return;
      }

      toast.success(isEditing ? "Colaborador atualizado." : "Colaborador criado.");
      router.push("/employees");
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
        <h1 className="text-2xl font-semibold">
          {isEditing ? "Editar colaborador" : "Novo colaborador"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEditing
            ? "Atualize os dados do colaborador."
            : "Preencha os dados para cadastrar um novo colaborador."}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <div className="grid gap-2">
              <Label htmlFor="employee-name">Nome</Label>
              <Input
                id="employee-name"
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name ? (
                <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="employee-document">Documento (CPF)</Label>
              <Input
                id="employee-document"
                placeholder="000.000.000-00"
                value={values.document}
                onChange={(event) => setField("document", maskCPF(event.target.value))}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.document)}
              />
              {fieldErrors.document ? (
                <p className="text-sm text-destructive">{fieldErrors.document[0]}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="employee-email">Email</Label>
                <Input
                  id="employee-email"
                  type="email"
                  value={values.email}
                  onChange={(event) => setField("email", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                {fieldErrors.email ? (
                  <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="employee-phone">Telefone</Label>
                <Input
                  id="employee-phone"
                  placeholder="(00) 00000-0000"
                  value={values.phone}
                  onChange={(event) => setField("phone", maskBrazilianPhone(event.target.value))}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="employee-registration">Matrícula</Label>
              <Input
                id="employee-registration"
                placeholder="Ex.: 00123"
                value={values.registration}
                onChange={(event) => setField("registration", event.target.value)}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Código interno da empresa para identificar o colaborador (o mesmo número da
                folha de pagamento/crachá, se houver). Não é o CPF — é opcional e só existe se a
                empresa já usar esse tipo de identificação.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Departamento</Label>
                <div className="flex items-center gap-2">
                  <Select
                    items={{
                      [NONE_VALUE]: "Nenhum",
                      ...Object.fromEntries(allDepartments.map((d) => [d.id, d.name])),
                    }}
                    value={values.departmentId}
                    onValueChange={(value) => setField("departmentId", value as string)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                      {allDepartments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <QuickCreateButton field="departmentId" label="Novo departamento" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Cargo</Label>
                <div className="flex items-center gap-2">
                  <Select
                    items={{
                      [NONE_VALUE]: "Nenhum",
                      ...Object.fromEntries(allPositions.map((p) => [p.id, p.name])),
                    }}
                    value={values.positionId}
                    onValueChange={(value) => setField("positionId", value as string)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                      {allPositions.map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          {position.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <QuickCreateButton field="positionId" label="Novo cargo" />
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Status do registro</Label>
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

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                {isEditing ? "Salvar alterações" : "Criar colaborador"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                render={<Link href="/employees" />}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <QuickCreateLookupDialog
        config={quickCreate?.config ?? null}
        open={Boolean(quickCreate)}
        onOpenChange={(open) => !open && setQuickCreate(null)}
        onCreated={handleQuickCreated}
      />
    </div>
  );
}
