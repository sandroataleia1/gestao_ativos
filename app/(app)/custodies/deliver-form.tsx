"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
import { SignatureQrDialog } from "@/components/custody/signature-qr-dialog";
import { PhotoPicker } from "@/components/custody/photo-picker";
import { dateOnlyToISOStringSafe } from "@/lib/date-only";
import type { AssetOption, AssetUnitOption, EmployeeOption } from "./types";

function nowForDateTimeInput() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const EMPTY_VALUES = {
  assetId: "",
  assetUnitId: "",
  quantity: "",
  deliveredAt: "",
  expectedReturnAt: "",
  reason: "",
  notes: "",
};

export function DeliverForm({
  employees,
  assets,
  availableUnits,
}: {
  employees: EmployeeOption[];
  assets: AssetOption[];
  availableUnits: AssetUnitOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => ({ ...EMPTY_VALUES, deliveredAt: nowForDateTimeInput() }));
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);

  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const employeeFilter = ComboboxPrimitive.useFilter({ sensitivity: "base" });

  const [signatureMode, setSignatureMode] = useState<"QR" | "WHATSAPP">("QR");
  const [signQrUrl, setSignQrUrl] = useState<string | null>(null);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === values.assetId) ?? null,
    [assets, values.assetId],
  );
  const isIndividual = selectedAsset?.trackingMode === "INDIVIDUAL";
  const unitsForAsset = useMemo(
    () => availableUnits.filter((unit) => unit.assetId === values.assetId),
    [availableUnits, values.assetId],
  );

  function setField<K extends keyof typeof EMPTY_VALUES>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!selectedEmployee) {
      setFormError("Selecione um colaborador.");
      return;
    }
    if (!selectedAsset) {
      setFormError("Selecione um ativo.");
      return;
    }
    const payload: Record<string, unknown> = {
      employeeId: selectedEmployee.id,
      assetId: values.assetId,
      deliveredAt: values.deliveredAt ? new Date(values.deliveredAt).toISOString() : undefined,
      expectedReturnAt: values.expectedReturnAt
        ? dateOnlyToISOStringSafe(values.expectedReturnAt)
        : undefined,
      reason: values.reason,
      notes: values.notes,
      photos: photos.length ? photos : undefined,
    };

    if (signatureMode === "WHATSAPP" && !selectedEmployee.phone) {
      setFormError("Colaborador não tem WhatsApp cadastrado. Edite o colaborador ou use o QR Code.");
      return;
    }
    payload.signatureDelivery = signatureMode;

    if (isIndividual) {
      if (!values.assetUnitId) {
        setFormError("Selecione a unidade a ser entregue.");
        return;
      }
      payload.assetUnitId = values.assetUnitId;
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
      const response = await fetch("/api/custodies/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível registrar a entrega.");
        return;
      }

      const data = await response.json().catch(() => null);
      toast.success("Entrega registrada.");
      if (data?.whatsappWarning) {
        toast.warning(data.whatsappWarning);
      }

      if (signatureMode === "QR" && data?.signUrl) {
        setSignQrUrl(data.signUrl);
      } else {
        router.push("/custodies");
        router.refresh();
      }
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nova entrega</h1>
        <p className="text-sm text-muted-foreground">
          Selecione o colaborador e o ativo — o formulário se ajusta conforme o modo de controle.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6">
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

        <Card>
          <CardContent className="grid gap-4 pt-6">
            <div className="grid gap-2">
              <Label htmlFor="custody-employee">Colaborador</Label>
              <Combobox
                items={employees}
                value={selectedEmployee}
                onValueChange={setSelectedEmployee}
                inputValue={employeeQuery}
                onInputValueChange={setEmployeeQuery}
                itemToStringLabel={(employee) => employee.name}
                isItemEqualToValue={(item, value) => item.id === value.id}
                filter={(employee, query) =>
                  query.trim().length >= 3 &&
                  employeeFilter.contains(employee, query, (e) => `${e.name} ${e.document}`)
                }
                disabled={isSubmitting}
              >
                <ComboboxInput
                  id="custody-employee"
                  placeholder="Digite ao menos 3 letras do nome..."
                  showTrigger={false}
                />
                <ComboboxContent>
                  <ComboboxEmpty>
                    {employeeQuery.trim().length < 3
                      ? "Digite ao menos 3 letras para buscar."
                      : "Nenhum colaborador encontrado."}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(employee: EmployeeOption) => (
                      <ComboboxItem key={employee.id} value={employee}>
                        {employee.name}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <div className="grid gap-2">
              <Label>Ativo</Label>
              <Select
                items={Object.fromEntries(
                  assets.map((asset) => [asset.id, `${asset.name} (${asset.assetCode})`]),
                )}
                value={values.assetId}
                onValueChange={(value) =>
                  setValues((prev) => ({
                    ...prev,
                    assetId: (value as string) ?? "",
                    assetUnitId: "",
                    quantity: "",
                  }))
                }
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
                <div className="grid gap-2">
                  <Label>Unidade</Label>
                  <Select
                    items={Object.fromEntries(
                      unitsForAsset.map((unit) => [
                        unit.id,
                        unit.serialNumber ?? unit.patrimonyNumber ?? unit.id,
                      ]),
                    )}
                    value={values.assetUnitId}
                    onValueChange={(value) => setField("assetUnitId", value as string)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {unitsForAsset.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.serialNumber ?? unit.patrimonyNumber ?? unit.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {unitsForAsset.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma unidade disponível para este ativo.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="custody-quantity">
                    Quantidade{selectedAsset.defaultUnit ? ` (${selectedAsset.defaultUnit})` : ""}
                  </Label>
                  <Input
                    id="custody-quantity"
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="custody-delivered-at">Data da entrega</Label>
                <Input
                  id="custody-delivered-at"
                  type="datetime-local"
                  value={values.deliveredAt}
                  onChange={(event) => setField("deliveredAt", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="custody-expected-return">Previsão de devolução</Label>
                <Input
                  id="custody-expected-return"
                  type="date"
                  value={values.expectedReturnAt}
                  onChange={(event) => setField("expectedReturnAt", event.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="custody-observations">Observação</Label>
              <Textarea
                id="custody-observations"
                rows={2}
                value={values.notes}
                onChange={(event) => setField("notes", event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <PhotoPicker
              photos={photos}
              onChange={setPhotos}
              disabled={isSubmitting}
              label="Fotos do ativo na entrega"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assinatura digital</CardTitle>
            <CardDescription>
              Gera o termo de responsabilidade junto com esta entrega — o colaborador sempre assina
              pelo próprio celular, seja lendo um QR Code na hora ou pelo link enviado no WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label>Como assinar</Label>
              <Select
                items={{ QR: "Assinar agora (QR Code presencial)", WHATSAPP: "Enviar por WhatsApp" }}
                value={signatureMode}
                onValueChange={(value) => setSignatureMode((value as "QR" | "WHATSAPP") ?? "QR")}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="QR">Assinar agora (QR Code presencial)</SelectItem>
                  <SelectItem value="WHATSAPP">Enviar por WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {signatureMode === "QR" ? (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                Ao finalizar a entrega, um QR Code será exibido para o colaborador escanear, ler o
                termo e assinar pelo próprio celular.
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-sm">
                {selectedEmployee ? (
                  selectedEmployee.phone ? (
                    <p className="text-muted-foreground">
                      O termo será enviado para <span className="font-medium text-foreground">{selectedEmployee.phone}</span>{" "}
                      assinar pelo WhatsApp.
                    </p>
                  ) : (
                    <p className="text-destructive">
                      Colaborador não tem WhatsApp cadastrado. Edite o colaborador ou selecione o
                      QR Code presencial.
                    </p>
                  )
                ) : (
                  <p className="text-muted-foreground">Selecione um colaborador para enviar o termo por WhatsApp.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Registrar entrega
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            render={<Link href="/custodies" />}
          >
            Cancelar
          </Button>
        </div>
      </form>

      <SignatureQrDialog
        open={!!signQrUrl}
        onOpenChange={(open) => {
          if (!open) {
            setSignQrUrl(null);
            router.push("/custodies");
            router.refresh();
          }
        }}
        signUrl={signQrUrl}
      />
    </div>
  );
}
