"use client";

import { useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Values = { whatsappApiUrl: string; whatsappApiKey: string; whatsappInstanceName: string };

export function WhatsappConfigForm({ initialValues }: { initialValues: Values }) {
  const [values, setValues] = useState<Values>(initialValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setField<K extends keyof Values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/company/whatsapp-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível salvar a configuração.");
        return;
      }

      toast.success("Configuração de WhatsApp salva.");
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <div className="grid gap-2">
        <Label htmlFor="whatsapp-api-url">URL da Evolution API</Label>
        <Input
          id="whatsapp-api-url"
          placeholder="https://sua-instancia.exemplo.com"
          value={values.whatsappApiUrl}
          onChange={(event) => setField("whatsappApiUrl", event.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="whatsapp-api-key">API key</Label>
          <Input
            id="whatsapp-api-key"
            value={values.whatsappApiKey}
            onChange={(event) => setField("whatsappApiKey", event.target.value)}
            disabled={isSubmitting}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="whatsapp-instance">Nome da instância</Label>
          <Input
            id="whatsapp-instance"
            value={values.whatsappInstanceName}
            onChange={(event) => setField("whatsappInstanceName", event.target.value)}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
