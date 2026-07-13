"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoPicker } from "@/components/custody/photo-picker";
import type { AssetBalanceMap, AssetOption, AssetUnitOption } from "../types";
import { shouldShowExpectedReturn, type ItemStepFieldErrors, type WizardValues } from "./wizard-logic";

// Etapa 2 do wizard — Sprint Demo Comercial, Parte 4. O formulário se
// adapta ao `trackingMode` do ativo escolhido (decidido pelo cadastro do
// ativo, nunca perguntado ao usuário aqui — Parte 4: "não criar uma etapa
// perguntando ao usuário se é consumível ou serializado").
export function StepItem({
  assets,
  selectedAsset,
  unitsForAsset,
  balanceByAsset,
  values,
  errors,
  onAssetChange,
  onFieldChange,
  disabled,
  firstErrorFieldRef,
}: {
  assets: AssetOption[];
  selectedAsset: AssetOption | null;
  unitsForAsset: AssetUnitOption[];
  balanceByAsset: AssetBalanceMap;
  values: WizardValues;
  errors: ItemStepFieldErrors;
  onAssetChange: (assetId: string) => void;
  onFieldChange: <K extends keyof WizardValues>(key: K, value: WizardValues[K]) => void;
  disabled?: boolean;
  firstErrorFieldRef?: React.RefObject<HTMLElement | null>;
}) {
  const isIndividual = selectedAsset?.trackingMode === "INDIVIDUAL";
  const available = selectedAsset ? (balanceByAsset[selectedAsset.id] ?? 0) : 0;

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-lg font-medium">Item e entrega</h2>
        <p className="text-sm text-muted-foreground">Selecione o item e informe as condições da entrega.</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="wizard-asset">Ativo</Label>
        <Select
          items={Object.fromEntries(assets.map((asset) => [asset.id, `${asset.name} (${asset.assetCode})`]))}
          value={values.assetId}
          onValueChange={(value) => onAssetChange((value as string) ?? "")}
          disabled={disabled}
        >
          <SelectTrigger id="wizard-asset" className="w-full" aria-describedby={errors.assetId ? "wizard-asset-error" : undefined}>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {assets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {asset.name} ({asset.assetCode})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.assetId ? (
          <p id="wizard-asset-error" className="text-sm text-destructive">
            {errors.assetId}
          </p>
        ) : null}
      </div>

      {selectedAsset ? (
        isIndividual ? (
          <div className="grid gap-2">
            <Label htmlFor="wizard-unit">Unidade disponível</Label>
            <Select
              items={Object.fromEntries(
                unitsForAsset.map((unit) => [unit.id, unit.serialNumber ?? unit.patrimonyNumber ?? unit.id]),
              )}
              value={values.assetUnitId}
              onValueChange={(value) => onFieldChange("assetUnitId", (value as string) ?? "")}
              disabled={disabled}
            >
              <SelectTrigger
                id="wizard-unit"
                className="w-full"
                aria-describedby={errors.assetUnitId ? "wizard-unit-error" : undefined}
              >
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {unitsForAsset.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    Série: {unit.serialNumber ?? unit.patrimonyNumber ?? unit.id}
                    {unit.condition ? ` · Condição: ${unit.condition}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.assetUnitId ? (
              <p id="wizard-unit-error" className="text-sm text-destructive">
                {errors.assetUnitId}
              </p>
            ) : unitsForAsset.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma unidade disponível para este ativo.</p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="wizard-quantity">
              Quantidade{selectedAsset.defaultUnit ? ` (${selectedAsset.defaultUnit})` : ""}
            </Label>
            <Input
              id="wizard-quantity"
              ref={firstErrorFieldRef as React.RefObject<HTMLInputElement>}
              type="number"
              min="0"
              step="any"
              value={values.quantity}
              onChange={(event) => onFieldChange("quantity", event.target.value)}
              disabled={disabled}
              aria-describedby="wizard-quantity-balance wizard-quantity-error"
              aria-invalid={Boolean(errors.quantity)}
            />
            <p id="wizard-quantity-balance" className="text-xs text-muted-foreground">
              Saldo disponível: {available} {selectedAsset.defaultUnit ?? "unidades"}
            </p>
            {errors.quantity ? (
              <p id="wizard-quantity-error" className="text-sm text-destructive">
                {errors.quantity}
              </p>
            ) : null}
          </div>
        )
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="wizard-delivered-at">Data e hora da entrega</Label>
          <Input
            id="wizard-delivered-at"
            type="datetime-local"
            value={values.deliveredAt}
            onChange={(event) => onFieldChange("deliveredAt", event.target.value)}
            disabled={disabled}
          />
        </div>
        {shouldShowExpectedReturn(selectedAsset) ? (
          <div className="grid gap-2">
            <Label htmlFor="wizard-expected-return">Previsão de devolução</Label>
            <Input
              id="wizard-expected-return"
              type="date"
              value={values.expectedReturnAt}
              onChange={(event) => onFieldChange("expectedReturnAt", event.target.value)}
              disabled={disabled}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="wizard-notes">Observação</Label>
        <Textarea
          id="wizard-notes"
          rows={2}
          maxLength={1000}
          value={values.notes}
          onChange={(event) => onFieldChange("notes", event.target.value)}
          disabled={disabled}
        />
      </div>

      <PhotoPicker
        photos={values.photos}
        onChange={(photos) => onFieldChange("photos", photos)}
        disabled={disabled}
        label="Fotos do ativo na entrega"
      />
    </div>
  );
}
