"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoPicker } from "@/components/custody/photo-picker";
import type { CustodyRow, LookupOption } from "./types";

const EMPTY_VALUES = { conditionId: "", destination: "STOCK", notes: "" };

export function ReturnDialog({
  custody,
  onOpenChange,
  conditions,
  onSuccess,
}: {
  custody: CustodyRow | null;
  onOpenChange: (open: boolean) => void;
  conditions: LookupOption[];
  onSuccess: () => void;
}) {
  const [values, setValues] = useState(EMPTY_VALUES);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (custody) {
      setValues(EMPTY_VALUES);
      setFormError(null);
      setPhotos([]);
    }
  }, [custody]);

  function setField<K extends keyof typeof EMPTY_VALUES>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!custody) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/custodies/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custodyId: custody.id,
          conditionId: custody.assetUnitId ? values.conditionId : undefined,
          destination: values.destination,
          notes: values.notes,
          photos: photos.length ? photos : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível registrar a devolução.");
        return;
      }

      toast.success("Devolução registrada.");
      onSuccess();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={!!custody} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Devolução</DialogTitle>
          <DialogDescription>
            {custody ? `${custody.employee.name} — ${custody.asset.name}` : null}
          </DialogDescription>
        </DialogHeader>

        {custody ? (
          <form onSubmit={handleSubmit} className="grid gap-4">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            {custody.assetUnitId ? (
              <div className="grid gap-2">
                <Label>Estado do item</Label>
                <Select
                  items={Object.fromEntries(conditions.map((condition) => [condition.id, condition.name]))}
                  value={values.conditionId}
                  onValueChange={(value) => setField("conditionId", value as string)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione (opcional)" />
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
            ) : null}

            <div className="grid gap-2">
              <Label>Destino</Label>
              <Select
                items={{ STOCK: "Retorna ao estoque", DISCARD: "Não retorna (baixa/descarte)" }}
                value={values.destination}
                onValueChange={(value) => setField("destination", (value as string) ?? "STOCK")}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STOCK">Retorna ao estoque</SelectItem>
                  <SelectItem value="DISCARD">Não retorna (baixa/descarte)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="return-observations">Observação</Label>
              <Textarea
                id="return-observations"
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
              label="Fotos do ativo na devolução"
            />

            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
                Confirmar devolução
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
