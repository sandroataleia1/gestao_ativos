import { dateOnlyToISOStringSafe, formatDateOnlyBR } from "@/lib/date-only";
import type { AssetBalanceMap, AssetOption, AssetUnitOption, EmployeeOption } from "../types";

// Lógica pura do wizard de nova entrega (Sprint Demo Comercial — Wizard de
// Nova Entrega, Parte 8) — nenhuma dependência de React, só do estado dos
// valores. Isso garante que "o resumo final reflete exatamente o estado que
// será enviado à API" (Parte 8): tanto a etapa 3 quanto o envio real usam
// `buildDeliverPayload`, nunca duas montagens de payload divergentes.

export type SignatureMode = "QR" | "WHATSAPP";

export type WizardValues = {
  assetId: string;
  assetUnitId: string;
  quantity: string;
  deliveredAt: string;
  expectedReturnAt: string;
  notes: string;
  photos: string[];
  signatureMode: SignatureMode;
};

export function initialWizardValues(): WizardValues {
  return {
    assetId: "",
    assetUnitId: "",
    quantity: "",
    deliveredAt: nowForDateTimeInput(),
    expectedReturnAt: "",
    notes: "",
    photos: [],
    signatureMode: "QR",
  };
}

export function nowForDateTimeInput(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function isEmployeeStepValid(employee: EmployeeOption | null): boolean {
  return employee !== null;
}

export type ItemStepFieldErrors = Partial<Record<"assetId" | "assetUnitId" | "quantity", string>>;

/**
 * Valida a etapa 2 conforme o modo de controle do ativo selecionado —
 * consumível (quantidade x saldo) ou serializado (unidade disponível).
 * Mesmas regras de bloqueio da API (Parte 2: "estoque negativo continua
 * bloqueado", "dupla custódia continua bloqueada"), verificadas aqui só
 * para dar feedback imediato — a API sempre revalida no servidor.
 */
export function getItemStepErrors(
  values: WizardValues,
  selectedAsset: AssetOption | null,
  balanceByAsset: AssetBalanceMap,
  unitsForAsset: AssetUnitOption[],
): ItemStepFieldErrors {
  const errors: ItemStepFieldErrors = {};

  if (!selectedAsset) {
    errors.assetId = "Selecione um item.";
    return errors;
  }

  if (selectedAsset.trackingMode === "INDIVIDUAL") {
    if (!values.assetUnitId) {
      errors.assetUnitId = "Selecione a unidade a ser entregue.";
    } else if (!unitsForAsset.some((unit) => unit.id === values.assetUnitId)) {
      // Unidade não está mais entre as disponíveis (ficou em custódia,
      // inativa, ou é de outro ativo) — nunca confia num valor de estado
      // "preso" a uma seleção antiga.
      errors.assetUnitId = "Esta unidade não está mais disponível. Selecione outra.";
    }
  } else {
    const quantity = Number(values.quantity);
    const available = balanceByAsset[selectedAsset.id] ?? 0;
    if (!values.quantity || Number.isNaN(quantity) || quantity <= 0) {
      errors.quantity = "Informe uma quantidade maior que zero.";
    } else if (quantity > available) {
      errors.quantity = `Saldo insuficiente — disponível: ${available}.`;
    }
  }

  return errors;
}

export function isItemStepValid(
  values: WizardValues,
  selectedAsset: AssetOption | null,
  balanceByAsset: AssetBalanceMap,
  unitsForAsset: AssetUnitOption[],
): boolean {
  return Object.keys(getItemStepErrors(values, selectedAsset, balanceByAsset, unitsForAsset)).length === 0;
}

/** Consumíveis não têm previsão de devolução com sentido (não retornam
 * fisicamente da mesma forma) — Parte 4, "ocultar previsão de devolução
 * quando ela não fizer sentido para consumíveis". */
export function shouldShowExpectedReturn(selectedAsset: AssetOption | null): boolean {
  return selectedAsset?.trackingMode === "INDIVIDUAL";
}

export function isSignatureModeAvailable(mode: SignatureMode, employee: EmployeeOption | null, whatsappConfigured: boolean): boolean {
  if (mode === "QR") return true;
  return whatsappConfigured && Boolean(employee?.phone);
}

/** Monta exatamente o payload que vai para `POST /api/custodies/deliver` —
 * usado tanto pelo envio real quanto pelo resumo da etapa 3, para que os
 * dois nunca divirjam (Parte 8). */
export function buildDeliverPayload(
  values: WizardValues,
  employee: EmployeeOption,
  selectedAsset: AssetOption,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    employeeId: employee.id,
    assetId: selectedAsset.id,
    deliveredAt: values.deliveredAt ? new Date(values.deliveredAt).toISOString() : undefined,
    notes: values.notes || undefined,
    photos: values.photos.length ? values.photos : undefined,
    signatureDelivery: values.signatureMode,
  };

  if (shouldShowExpectedReturn(selectedAsset) && values.expectedReturnAt) {
    payload.expectedReturnAt = dateOnlyToISOStringSafe(values.expectedReturnAt);
  }

  if (selectedAsset.trackingMode === "INDIVIDUAL") {
    payload.assetUnitId = values.assetUnitId;
  } else {
    payload.quantity = Number(values.quantity);
  }

  return payload;
}

const SIGNATURE_MODE_LABEL: Record<SignatureMode, string> = {
  QR: "QR Code presencial",
  WHATSAPP: "Envio por WhatsApp",
};

export type DeliverySummary = {
  employeeName: string;
  employeeRole: string | null;
  itemLabel: string;
  quantityOrSerial: string;
  deliveredAtLabel: string;
  expectedReturnLabel: string | null;
  notes: string | null;
  photoCount: number;
  signatureModeLabel: string;
};

/**
 * Mesma fonte de verdade para o resumo lateral (Parte 11) e para a revisão
 * completa da etapa 3 (Parte 4) — nunca duas montagens que possam divergir
 * (Parte 8: "dados exibidos no resumo não podem vir de valores antigos").
 * Só monta o que já está disponível; campos ainda não preenchidos voltam
 * `null`/vazio para quem exibe decidir se omite a linha.
 */
export function buildDeliverySummary(
  values: WizardValues,
  employee: EmployeeOption | null,
  selectedAsset: AssetOption | null,
  unitsForAsset: AssetUnitOption[],
): DeliverySummary | null {
  if (!employee) return null;

  const unit = values.assetUnitId ? unitsForAsset.find((u) => u.id === values.assetUnitId) : undefined;
  const isIndividual = selectedAsset?.trackingMode === "INDIVIDUAL";

  let quantityOrSerial = "";
  if (selectedAsset) {
    quantityOrSerial = isIndividual
      ? unit
        ? `Série: ${unit.serialNumber ?? unit.patrimonyNumber ?? unit.id}`
        : ""
      : values.quantity
        ? `${values.quantity} ${selectedAsset.defaultUnit ?? "unidade(s)"}`
        : "";
  }

  return {
    employeeName: employee.name,
    employeeRole: [employee.position, employee.department].filter(Boolean).join(" · ") || null,
    itemLabel: selectedAsset ? `${selectedAsset.name} (${selectedAsset.assetCode})` : "",
    quantityOrSerial,
    deliveredAtLabel: values.deliveredAt
      ? new Date(values.deliveredAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "",
    expectedReturnLabel:
      shouldShowExpectedReturn(selectedAsset) && values.expectedReturnAt
        ? formatDateOnlyBR(dateOnlyToISOStringSafe(values.expectedReturnAt))
        : null,
    notes: values.notes || null,
    photoCount: values.photos.length,
    signatureModeLabel: SIGNATURE_MODE_LABEL[values.signatureMode],
  };
}
