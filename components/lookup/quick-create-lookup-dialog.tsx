"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type LookupOption = { id: string; name: string };

export type QuickCreateConfig = {
  title: string;
  apiBasePath: string;
  nameField: string;
  nameLabel: string;
  responseKey: string;
  // Só faz sentido quando existe uma tela de gestão completa pra esse
  // cadastro (ex.: Categoria/Fabricante/Fornecedor têm /cadastros; Cargo e
  // Departamento, por enquanto, só têm criação rápida — sem essa tela).
  manageHint?: string;
};

// Criação rápida (só o nome) usada pelos botões "+" ao lado de Selects de
// cadastros de apoio (Categoria/Fabricante/Fornecedor no ativo, Cargo/
// Departamento no colaborador) — evita sair da tela pra cadastrar um item
// que ainda não existe.
export function QuickCreateLookupDialog({
  config,
  open,
  onOpenChange,
  onCreated,
}: {
  config: QuickCreateConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (option: LookupOption) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    setError(null);

    if (!value.trim()) {
      setError("Informe um nome.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(config.apiBasePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [config.nameField]: value }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Não foi possível criar.");
        return;
      }

      const data = await response.json();
      const created = data[config.responseKey];
      toast.success(`${config.title} criado(a).`);
      onCreated({ id: created.id, name: created[config.nameField] });
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open && Boolean(config)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo(a) {config?.title.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Cria rapidamente, só com {config?.nameLabel.toLowerCase()}.
            {config?.manageHint ? ` ${config.manageHint}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="grid gap-2">
            <Label htmlFor="quick-create-name">{config?.nameLabel}</Label>
            <Input
              id="quick-create-name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
