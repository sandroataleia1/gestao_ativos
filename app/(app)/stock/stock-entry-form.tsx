"use client";

import { useMemo, useState, type FormEvent } from "react";
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
import type { AssetOption, LookupOption } from "./types";

function nowForDateTimeInput() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const EMPTY_VALUES = {
  assetId: "",
  quantity: "",
  serialNumbersText: "",
  statusId: "",
  conditionId: "",
  observations: "",
  executedAt: "",
};

export function StockEntryForm({
  assets,
  statuses,
  conditions,
}: {
  assets: AssetOption[];
  statuses: LookupOption[];
  conditions: LookupOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => ({ ...EMPTY_VALUES, executedAt: nowForDateTimeInput() }));
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === values.assetId) ?? null,
    [assets, values.assetId],
  );
  const isIndividual = selectedAsset?.trackingMode === "INDIVIDUAL";

  function setField<K extends keyof typeof EMPTY_VALUES>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!selectedAsset) {
      setFormError("Selecione um ativo.");
      return;
    }

    const payload: Record<string, unknown> = {
      assetId: values.assetId,
      observations: values.observations,
      executedAt: values.executedAt ? new Date(values.executedAt).toISOString() : undefined,
    };

    if (isIndividual) {
      const serialNumbers = values.serialNumbersText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (serialNumbers.length === 0) {
        setFormError("Informe ao menos um número de série/patrimônio (um por linha).");
        return;
      }
      if (!values.statusId || !values.conditionId) {
        setFormError("Selecione status e condição para as novas unidades.");
        return;
      }
      payload.serialNumbers = serialNumbers;
      payload.statusId = values.statusId;
      payload.conditionId = values.conditionId;
    } else {
      const quantity = Number(values.quantity);
      if (!values.quantity || Number.isNaN(quantity) || quantity <= 0) {
        setFormError("Informe uma quantidade maior que zero.");
        return;
      }
      payload.quantity = quantity;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/stock/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível registrar a entrada.");
        return;
      }

      toast.success("Entrada de estoque registrada.");
      router.push("/stock");
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
        <h1 className="text-2xl font-semibold">Nova entrada de estoque</h1>
        <p className="text-sm text-muted-foreground">
          Selecione o ativo — o formulário se ajusta conforme o modo de controle dele. A entrada é
          sempre registrada no almoxarifado principal da empresa.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <div className="grid gap-2">
              <Label>Ativo</Label>
              <Select
                items={Object.fromEntries(
                  assets.map((asset) => [asset.id, `${asset.name} (${asset.assetCode})`]),
                )}
                value={values.assetId}
                onValueChange={(value) => setField("assetId", value as string)}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
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
            </div>

            {selectedAsset ? (
              isIndividual ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="stock-serials">Números de série/patrimônio</Label>
                    <Textarea
                      id="stock-serials"
                      rows={4}
                      placeholder={"Um por linha, ex.:\nSN-0001\nSN-0002"}
                      value={values.serialNumbersText}
                      onChange={(event) => setField("serialNumbersText", event.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Uma unidade será criada para cada linha.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Status</Label>
                      <Select
                        items={Object.fromEntries(statuses.map((s) => [s.id, s.name]))}
                        value={values.statusId}
                        onValueChange={(value) => setField("statusId", value as string)}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger className="w-full">
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
                    </div>
                    <div className="grid gap-2">
                      <Label>Condição</Label>
                      <Select
                        items={Object.fromEntries(conditions.map((c) => [c.id, c.name]))}
                        value={values.conditionId}
                        onValueChange={(value) => setField("conditionId", value as string)}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger className="w-full">
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
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="stock-quantity">
                    Quantidade{selectedAsset.defaultUnit ? ` (${selectedAsset.defaultUnit})` : ""}
                  </Label>
                  <Input
                    id="stock-quantity"
                    type="number"
                    min="0"
                    step="any"
                    value={values.quantity}
                    onChange={(event) => setField("quantity", event.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              )
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="stock-executed-at">Data da movimentação</Label>
              <Input
                id="stock-executed-at"
                type="datetime-local"
                value={values.executedAt}
                onChange={(event) => setField("executedAt", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="stock-observations">Observação</Label>
              <Textarea
                id="stock-observations"
                rows={2}
                value={values.observations}
                onChange={(event) => setField("observations", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                Registrar entrada
              </Button>
              <Button type="button" variant="outline" disabled={isSubmitting} render={<Link href="/stock" />}>
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
