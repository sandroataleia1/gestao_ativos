"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { focusFirstFieldWithError } from "@/lib/form-focus";
import {
  QuickCreateLookupDialog,
  type QuickCreateConfig,
} from "@/components/lookup/quick-create-lookup-dialog";
import type { AssetRow, LookupOption } from "./types";

const NONE_VALUE = "none";
const OUTRO_UNIT_VALUE = "OUTRO";

// Lista fechada para evitar o problema clássico de relatório quebrado por
// grafia livre ("un"/"UN"/"unidade"/"und" todos representando a mesma
// coisa). "Outro" cobre o caso que a lista não previu, mas persiste
// exatamente o texto informado (defaultUnit continua String livre no
// schema — nenhuma migration necessária).
const UNIT_OPTIONS = ["UN", "PAR", "KG", "G", "L", "ML", "CX", "PCT", "M", "CM", "KIT"] as const;

const CA_STATUS_LABELS: Record<string, string> = {
  VALID: "Válido",
  EXPIRED: "Vencido",
  SUSPENDED: "Suspenso",
  CANCELLED: "Cancelado",
  PENDING: "Pendente",
};

type LookupListKey = "categories" | "manufacturers" | "suppliers";
type QuickCreateFieldKey = "categoryId" | "manufacturerId" | "supplierId";

const MANAGE_HINT = "Para editar os demais campos, use a tela de Cadastros depois.";

const QUICK_CREATE_MAP: Record<QuickCreateFieldKey, QuickCreateConfig & { listKey: LookupListKey }> = {
  categoryId: {
    title: "Categoria",
    apiBasePath: "/api/asset-categories",
    nameField: "name",
    nameLabel: "Nome",
    responseKey: "category",
    listKey: "categories",
    manageHint: MANAGE_HINT,
  },
  manufacturerId: {
    title: "Fabricante",
    apiBasePath: "/api/manufacturers",
    nameField: "name",
    nameLabel: "Nome",
    responseKey: "manufacturer",
    listKey: "manufacturers",
    manageHint: MANAGE_HINT,
  },
  supplierId: {
    title: "Fornecedor",
    apiBasePath: "/api/suppliers",
    nameField: "corporateName",
    nameLabel: "Razão social",
    responseKey: "supplier",
    listKey: "suppliers",
    manageHint: MANAGE_HINT,
  },
};

type FormValues = {
  name: string;
  assetCode: string;
  categoryId: string;
  manufacturerId: string;
  supplierId: string;
  statusId: string;
  conditionId: string;
  trackingMode: "INDIVIDUAL" | "CONSUMABLE";
  defaultUnit: string;
  minimumStock: string;
  description: string;
  // "Status do registro" na UI — nome do campo no banco (`active`) e no
  // payload da API permanece o mesmo, só o rótulo mudou (ver seção 1 do
  // pedido de refino de UX). Renomear a coluna exigiria migration.
  active: "true" | "false";
  // Certificado de Aprovação (CA) — ver lib/certifications e
  // docs/certifications.md. Campos próprios do tipo CA (fabricante
  // homologado, descrição oficial, tipo de proteção, norma aplicável) vão
  // dentro de `metadata` no payload.
  caEnabled: "yes" | "no";
  caId: string;
  caCertificationNumber: string;
  caStatus: string;
  caIssueDate: string;
  caExpirationDate: string;
  caIssuer: string;
  caApprovedManufacturer: string;
  caOfficialDescription: string;
  caProtectionType: string;
  caApplicableStandard: string;
};

function pickDefaultId(options: LookupOption[], preferredNames: string[]): string {
  if (!options.length) return "";
  const preferred = options.find((option) =>
    preferredNames.some((name) => option.name.trim().toLowerCase() === name.toLowerCase()),
  );
  return (preferred ?? options[0]).id;
}

function emptyValues(statuses: LookupOption[], conditions: LookupOption[]): FormValues {
  return {
    name: "",
    assetCode: "",
    categoryId: "",
    manufacturerId: NONE_VALUE,
    supplierId: NONE_VALUE,
    // Não existe conceito de "status/condição padrão" marcado no schema —
    // na ausência disso, usamos o item cujo nome bate com o padrão do
    // sistema (Disponível/Novo) e, se não houver, o primeiro da lista.
    statusId: pickDefaultId(statuses, ["Disponível"]),
    conditionId: pickDefaultId(conditions, ["Novo"]),
    trackingMode: "INDIVIDUAL",
    defaultUnit: "",
    minimumStock: "",
    description: "",
    active: "true",
    caEnabled: "no",
    caId: "",
    caCertificationNumber: "",
    caStatus: "VALID",
    caIssueDate: "",
    caExpirationDate: "",
    caIssuer: "",
    caApprovedManufacturer: "",
    caOfficialDescription: "",
    caProtectionType: "",
    caApplicableStandard: "",
  };
}

function toDateInputValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toFormValues(
  asset: AssetRow | null,
  statuses: LookupOption[],
  conditions: LookupOption[],
): FormValues {
  if (!asset) return emptyValues(statuses, conditions);

  const ca = asset.certifications.find((c) => c.certificationType === "CA") ?? null;
  const metadata = (ca?.metadata as Record<string, unknown> | null) ?? null;

  return {
    name: asset.name,
    assetCode: asset.assetCode,
    categoryId: asset.categoryId,
    manufacturerId: asset.manufacturerId ?? NONE_VALUE,
    supplierId: asset.supplierId ?? NONE_VALUE,
    statusId: asset.statusId,
    conditionId: asset.conditionId,
    trackingMode: asset.trackingMode,
    defaultUnit: asset.defaultUnit ?? "",
    minimumStock: asset.minimumStock !== null ? String(asset.minimumStock) : "",
    description: asset.description ?? "",
    active: asset.active ? "true" : "false",
    caEnabled: ca ? "yes" : "no",
    caId: ca?.id ?? "",
    caCertificationNumber: ca?.certificationNumber ?? "",
    caStatus: ca?.status ?? "VALID",
    caIssueDate: toDateInputValue(ca?.issueDate ?? null),
    caExpirationDate: toDateInputValue(ca?.expirationDate ?? null),
    caIssuer: ca?.issuer ?? "",
    caApprovedManufacturer: (metadata?.approvedManufacturer as string) ?? "",
    caOfficialDescription: (metadata?.officialDescription as string) ?? "",
    caProtectionType: (metadata?.protectionType as string) ?? "",
    caApplicableStandard: (metadata?.applicableStandard as string) ?? "",
  };
}

export function AssetForm({
  asset,
  categories,
  manufacturers,
  suppliers,
  statuses,
  conditions,
  canManageCategory,
  canManageManufacturer,
  canManageSupplier,
}: {
  asset: AssetRow | null;
  categories: LookupOption[];
  manufacturers: LookupOption[];
  suppliers: LookupOption[];
  statuses: LookupOption[];
  conditions: LookupOption[];
  canManageCategory: boolean;
  canManageManufacturer: boolean;
  canManageSupplier: boolean;
}) {
  const router = useRouter();
  const isEditing = Boolean(asset);
  const [values, setValues] = useState<FormValues>(() => toFormValues(asset, statuses, conditions));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fabricante/Fornecedor/Descrição começam recolhidos para reduzir carga
  // cognitiva num cadastro simples — mas se o ativo editado já tiver algum
  // desses preenchido, abre expandido para não esconder dado existente.
  const [showAdditional, setShowAdditional] = useState(
    () =>
      Boolean(asset) &&
      (Boolean(asset?.manufacturerId) || Boolean(asset?.supplierId) || Boolean(asset?.description)),
  );

  const initialUnit = (asset?.defaultUnit ?? "").trim().toUpperCase();
  const [customUnitMode, setCustomUnitMode] = useState(
    () => initialUnit !== "" && !UNIT_OPTIONS.includes(initialUnit as (typeof UNIT_OPTIONS)[number]),
  );

  // Estoque inicial — só no cadastro de um ativo novo (editar não mexe em
  // estoque). Evita o vai-e-volta de criar o ativo e só depois ir em
  // Estoque > Nova entrada, útil principalmente quando a empresa só tem
  // aquele primeiro item para lançar.
  const [hasInitialStock, setHasInitialStock] = useState(false);
  const [initialQuantity, setInitialQuantity] = useState("");
  const [initialSerialNumbersText, setInitialSerialNumbersText] = useState("");
  const [initialStockError, setInitialStockError] = useState<string | null>(null);

  const [extraOptions, setExtraOptions] = useState<Record<LookupListKey, LookupOption[]>>({
    categories: [],
    manufacturers: [],
    suppliers: [],
  });
  const [quickCreate, setQuickCreate] = useState<{
    field: QuickCreateFieldKey;
    config: QuickCreateConfig & { listKey: LookupListKey };
  } | null>(null);

  const allCategories = useMemo(
    () => [...categories, ...extraOptions.categories],
    [categories, extraOptions.categories],
  );
  const allManufacturers = useMemo(
    () => [...manufacturers, ...extraOptions.manufacturers],
    [manufacturers, extraOptions.manufacturers],
  );
  const allSuppliers = useMemo(
    () => [...suppliers, ...extraOptions.suppliers],
    [suppliers, extraOptions.suppliers],
  );

  const normalizedUnit = values.defaultUnit.trim().toUpperCase();
  const unitSelectValue = customUnitMode
    ? OUTRO_UNIT_VALUE
    : UNIT_OPTIONS.includes(normalizedUnit as (typeof UNIT_OPTIONS)[number])
      ? normalizedUnit
      : "";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setInitialStockError(null);

    if (values.caEnabled === "yes" && !values.caCertificationNumber.trim()) {
      setFormError("Informe o número do CA ou clique em \"Ocultar\" para não incluir certificação.");
      return;
    }

    let initialStockPayload: Record<string, unknown> | null = null;
    if (!isEditing && hasInitialStock) {
      if (values.trackingMode === "CONSUMABLE") {
        const quantity = Number(initialQuantity);
        if (!initialQuantity || Number.isNaN(quantity) || quantity <= 0) {
          setInitialStockError("Informe uma quantidade maior que zero.");
          return;
        }
        initialStockPayload = { quantity };
      } else {
        const serialNumbers = initialSerialNumbersText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (serialNumbers.length === 0) {
          setInitialStockError("Informe ao menos um número de série/patrimônio (um por linha).");
          return;
        }
        initialStockPayload = { serialNumbers };
      }
    }

    setIsSubmitting(true);
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      name: values.name,
      assetCode: values.assetCode,
      categoryId: values.categoryId,
      manufacturerId: values.manufacturerId === NONE_VALUE ? "" : values.manufacturerId,
      supplierId: values.supplierId === NONE_VALUE ? "" : values.supplierId,
      statusId: values.statusId,
      conditionId: values.conditionId,
      trackingMode: values.trackingMode,
      defaultUnit: values.defaultUnit,
      minimumStock: values.minimumStock,
      description: values.description,
      active: values.active === "true",
    };

    if (values.caEnabled === "yes") {
      payload.certification = {
        id: values.caId || undefined,
        certificationType: "CA",
        certificationNumber: values.caCertificationNumber,
        status: values.caStatus,
        issueDate: values.caIssueDate || undefined,
        expirationDate: values.caExpirationDate || undefined,
        issuer: values.caIssuer,
        metadata: {
          approvedManufacturer: values.caApprovedManufacturer || undefined,
          officialDescription: values.caOfficialDescription || undefined,
          protectionType: values.caProtectionType || undefined,
          applicableStandard: values.caApplicableStandard || undefined,
        },
      };
    }

    try {
      const response = await fetch(isEditing ? `/api/assets/${asset!.id}` : "/api/assets", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          const idByField: Record<string, string> = {
            categoryId: "asset-category",
            name: "asset-name",
            assetCode: "asset-code",
            statusId: "asset-status",
            conditionId: "asset-condition",
          };
          focusFirstFieldWithError(
            data.fieldErrors,
            ["categoryId", "name", "assetCode", "statusId", "conditionId"],
            (key) => idByField[key] ?? key,
          );
        }
        setFormError(data?.error ?? "Não foi possível salvar o ativo.");
        return;
      }

      const data = await response.json();

      if (initialStockPayload) {
        try {
          const stockResponse = await fetch("/api/stock/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assetId: data.asset.id,
              statusId: values.statusId,
              conditionId: values.conditionId,
              ...initialStockPayload,
            }),
          });
          if (!stockResponse.ok) {
            const stockData = await stockResponse.json().catch(() => null);
            toast.error(
              `Ativo criado, mas não foi possível registrar o estoque inicial: ${
                stockData?.error ?? "erro desconhecido"
              }. Você pode lançar em Estoque > Nova entrada.`,
            );
          } else {
            toast.success("Ativo criado e estoque inicial registrado.");
          }
        } catch {
          toast.error(
            "Ativo criado, mas não foi possível registrar o estoque inicial. Você pode lançar em Estoque > Nova entrada.",
          );
        }
      } else {
        toast.success(isEditing ? "Ativo atualizado." : "Ativo criado.");
      }

      router.push("/assets");
      router.refresh();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function QuickCreateButton({
    field,
    canManage = true,
    label,
  }: {
    field: QuickCreateFieldKey;
    canManage?: boolean;
    label: string;
  }) {
    if (!canManage) return null;
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

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{isEditing ? "Editar ativo" : "Novo ativo"}</h1>
        <p className="text-sm text-muted-foreground">
          {isEditing
            ? "Atualize os dados do cadastro mestre do ativo."
            : "Preencha os dados para cadastrar um novo ativo."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid max-w-5xl gap-6">
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
            <CardDescription>Categoria, nome e código do ativo.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="asset-category">Categoria</Label>
              <div className="flex items-center gap-2">
                <Select
                  items={Object.fromEntries(allCategories.map((c) => [c.id, c.name]))}
                  value={values.categoryId}
                  onValueChange={(value) => setField("categoryId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="asset-category"
                    className="w-full"
                    aria-invalid={Boolean(fieldErrors.categoryId)}
                  >
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {allCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <QuickCreateButton
                  field="categoryId"
                  canManage={canManageCategory}
                  label="Nova categoria"
                />
              </div>
              {fieldErrors.categoryId ? (
                <p className="text-sm text-destructive">{fieldErrors.categoryId[0]}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="asset-name">Nome</Label>
                <Input
                  id="asset-name"
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
                <Label htmlFor="asset-code">Código/SKU</Label>
                <Input
                  id="asset-code"
                  placeholder="Ex.: ABC-00123"
                  value={values.assetCode}
                  onChange={(event) => setField("assetCode", event.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(fieldErrors.assetCode)}
                />
                {fieldErrors.assetCode ? (
                  <p className="text-sm text-destructive">{fieldErrors.assetCode[0]}</p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controle</CardTitle>
            <CardDescription>Como o ativo é rastreado e sua situação atual.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="asset-tracking-mode">Modo de controle</Label>
                <Select
                  items={{
                    INDIVIDUAL: "Individual (por série/patrimônio)",
                    CONSUMABLE: "Consumível (por quantidade)",
                  }}
                  value={values.trackingMode}
                  onValueChange={(value) =>
                    setField("trackingMode", value as FormValues["trackingMode"])
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="asset-tracking-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INDIVIDUAL">Individual (por série/patrimônio)</SelectItem>
                    <SelectItem value="CONSUMABLE">Consumível (por quantidade)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {values.trackingMode === "CONSUMABLE"
                    ? "Controlado por quantidade em estoque."
                    : "Cada unidade possui patrimônio ou número de série."}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="asset-unit">Unidade de medida</Label>
                <Select
                  items={{
                    ...Object.fromEntries(UNIT_OPTIONS.map((unit) => [unit, unit])),
                    [OUTRO_UNIT_VALUE]: "Outro",
                  }}
                  value={unitSelectValue}
                  onValueChange={(value) => {
                    if (value === OUTRO_UNIT_VALUE) {
                      setCustomUnitMode(true);
                      if (UNIT_OPTIONS.includes(normalizedUnit as (typeof UNIT_OPTIONS)[number])) {
                        setField("defaultUnit", "");
                      }
                    } else {
                      setCustomUnitMode(false);
                      setField("defaultUnit", value as string);
                    }
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="asset-unit" className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                    <SelectItem value={OUTRO_UNIT_VALUE}>Outro</SelectItem>
                  </SelectContent>
                </Select>
                {customUnitMode ? (
                  <Input
                    aria-label="Informe a unidade"
                    placeholder="Informe a unidade"
                    value={values.defaultUnit}
                    onChange={(event) => setField("defaultUnit", event.target.value)}
                    disabled={isSubmitting}
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">Utilizada para controle e relatórios.</p>
              </div>
            </div>

            {values.trackingMode === "CONSUMABLE" ? (
              <div className="grid gap-2">
                <Label htmlFor="asset-minimum-stock">Estoque mínimo</Label>
                <Input
                  id="asset-minimum-stock"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Deixe em branco para não alertar sobre estoque baixo"
                  value={values.minimumStock}
                  onChange={(event) => setField("minimumStock", event.target.value)}
                  disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                  Usado pela central de alertas para avisar quando o saldo total ficar abaixo
                  deste valor.
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="asset-status">Status</Label>
                <Select
                  items={Object.fromEntries(statuses.map((s) => [s.id, s.name]))}
                  value={values.statusId}
                  onValueChange={(value) => setField("statusId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="asset-status"
                    className="w-full"
                    aria-invalid={Boolean(fieldErrors.statusId)}
                  >
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.statusId ? (
                  <p className="text-sm text-destructive">{fieldErrors.statusId[0]}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="asset-condition">Condição</Label>
                <Select
                  items={Object.fromEntries(conditions.map((c) => [c.id, c.name]))}
                  value={values.conditionId}
                  onValueChange={(value) => setField("conditionId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="asset-condition"
                    className="w-full"
                    aria-invalid={Boolean(fieldErrors.conditionId)}
                  >
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {conditions.map((condition) => (
                      <SelectItem key={condition.id} value={condition.id}>
                        {condition.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.conditionId ? (
                  <p className="text-sm text-destructive">{fieldErrors.conditionId[0]}</p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="asset-active">Status do registro</Label>
                <Select
                  items={{ true: "Ativo", false: "Inativo" }}
                  value={values.active}
                  onValueChange={(value) => setField("active", value as FormValues["active"])}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="asset-active" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Ativo</SelectItem>
                    <SelectItem value="false">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isEditing ? (
          hasInitialStock ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Estoque inicial</CardTitle>
                    <CardDescription>
                      Registra a quantidade já disponível assim que o ativo for criado — sem
                      precisar ir à tela de Estoque depois.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setHasInitialStock(false)}
                  >
                    Ocultar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {initialStockError ? (
                  <p className="text-sm text-destructive">{initialStockError}</p>
                ) : null}
                {values.trackingMode === "CONSUMABLE" ? (
                  <div className="grid max-w-xs gap-2">
                    <Label htmlFor="initial-stock-quantity">
                      Quantidade{values.defaultUnit ? ` (${values.defaultUnit})` : ""}
                    </Label>
                    <Input
                      id="initial-stock-quantity"
                      type="number"
                      min="0"
                      step="any"
                      value={initialQuantity}
                      onChange={(event) => setInitialQuantity(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label htmlFor="initial-stock-serials">Números de série/patrimônio</Label>
                    <Textarea
                      id="initial-stock-serials"
                      rows={3}
                      placeholder={"Um por linha, ex.:\nSN-0001\nSN-0002"}
                      value={initialSerialNumbersText}
                      onChange={(event) => setInitialSerialNumbersText(event.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Uma unidade será criada para cada linha, usando o Status e a Condição
                      selecionados acima.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div>
                  <p className="text-sm font-medium">Estoque inicial</p>
                  <p className="text-xs text-muted-foreground">
                    Já tem esse ativo em mãos? Registre a quantidade agora e pule a etapa de
                    lançar entrada de estoque depois.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setHasInitialStock(true)}>
                  <PlusIcon />
                  Adicionar estoque inicial
                </Button>
              </CardContent>
            </Card>
          )
        ) : null}

        {values.caEnabled === "yes" ? (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Regulatório</CardTitle>
                  <CardDescription>
                    Certificado de Aprovação (CA) e dados de conformidade do ativo.
                  </CardDescription>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setField("caEnabled", "no")}>
                  Ocultar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ca-number">Número do CA</Label>
                  <Input
                    id="ca-number"
                    value={values.caCertificationNumber}
                    onChange={(event) => setField("caCertificationNumber", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ca-expiration-date">Validade</Label>
                  <Input
                    id="ca-expiration-date"
                    type="date"
                    value={values.caExpirationDate}
                    onChange={(event) => setField("caExpirationDate", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ca-status">Situação</Label>
                  <Select
                    items={CA_STATUS_LABELS}
                    value={values.caStatus}
                    onValueChange={(value) => setField("caStatus", value as string)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="ca-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CA_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ca-issue-date">Emissão</Label>
                  <Input
                    id="ca-issue-date"
                    type="date"
                    value={values.caIssueDate}
                    onChange={(event) => setField("caIssueDate", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ca-issuer">Órgão emissor</Label>
                <Input
                  id="ca-issuer"
                  value={values.caIssuer}
                  onChange={(event) => setField("caIssuer", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ca-manufacturer">Fabricante homologado</Label>
                <Input
                  id="ca-manufacturer"
                  value={values.caApprovedManufacturer}
                  onChange={(event) => setField("caApprovedManufacturer", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ca-protection-type">Tipo de proteção</Label>
                  <Input
                    id="ca-protection-type"
                    value={values.caProtectionType}
                    onChange={(event) => setField("caProtectionType", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ca-standard">Norma aplicável</Label>
                  <Input
                    id="ca-standard"
                    value={values.caApplicableStandard}
                    onChange={(event) => setField("caApplicableStandard", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ca-description">Descrição oficial</Label>
                <Textarea
                  id="ca-description"
                  rows={2}
                  value={values.caOfficialDescription}
                  onChange={(event) => setField("caOfficialDescription", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div>
                <p className="text-sm font-medium">Certificação (CA)</p>
                <p className="text-xs text-muted-foreground">
                  Obrigatório para EPIs e equipamentos regulamentados; deixe assim se não se
                  aplicar a este ativo.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setField("caEnabled", "yes")}>
                <PlusIcon />
                Adicionar certificação
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <button
              type="button"
              onClick={() => setShowAdditional((prev) => !prev)}
              className="flex cursor-pointer items-center gap-2 text-left"
              aria-expanded={showAdditional}
            >
              {showAdditional ? (
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              )}
              <CardTitle>Informações adicionais</CardTitle>
            </button>
            <CardDescription>Fabricante, fornecedor e descrição — opcional.</CardDescription>
          </CardHeader>
          {showAdditional ? (
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="asset-manufacturer">Fabricante</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      items={{
                        [NONE_VALUE]: "Nenhum",
                        ...Object.fromEntries(allManufacturers.map((m) => [m.id, m.name])),
                      }}
                      value={values.manufacturerId}
                      onValueChange={(value) => setField("manufacturerId", value as string)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="asset-manufacturer" className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                        {allManufacturers.map((manufacturer) => (
                          <SelectItem key={manufacturer.id} value={manufacturer.id}>
                            {manufacturer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <QuickCreateButton
                      field="manufacturerId"
                      canManage={canManageManufacturer}
                      label="Novo fabricante"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="asset-supplier">Fornecedor</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      items={{
                        [NONE_VALUE]: "Nenhum",
                        ...Object.fromEntries(allSuppliers.map((s) => [s.id, s.name])),
                      }}
                      value={values.supplierId}
                      onValueChange={(value) => setField("supplierId", value as string)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="asset-supplier" className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>Nenhum</SelectItem>
                        {allSuppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <QuickCreateButton
                      field="supplierId"
                      canManage={canManageSupplier}
                      label="Novo fornecedor"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="asset-description">Descrição</Label>
                <Textarea
                  id="asset-description"
                  rows={3}
                  value={values.description}
                  onChange={(event) => setField("description", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </CardContent>
          ) : null}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            {isEditing ? "Salvar alterações" : "Criar ativo"}
          </Button>
          <Button type="button" variant="outline" disabled={isSubmitting} render={<Link href="/assets" />}>
            Cancelar
          </Button>
        </div>
      </form>

      <QuickCreateLookupDialog
        config={quickCreate?.config ?? null}
        open={Boolean(quickCreate)}
        onOpenChange={(open) => !open && setQuickCreate(null)}
        onCreated={handleQuickCreated}
      />
    </div>
  );
}
