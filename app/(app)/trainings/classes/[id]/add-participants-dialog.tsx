"use client";

import { useMemo, useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { EmployeeOption } from "./types";

export function AddParticipantsDialog({
  open,
  onOpenChange,
  trainingClassId,
  activeEmployees,
  existingEmployeeIds,
  maximumParticipants,
  currentParticipantCount,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainingClassId: string;
  activeEmployees: EmployeeOption[];
  existingEmployeeIds: Set<string>;
  maximumParticipants: number | null;
  currentParticipantCount: number;
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeEmployees;
    return activeEmployees.filter((employee) =>
      [employee.name, employee.document, employee.registration ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [activeEmployees, search]);

  const remainingCapacity =
    maximumParticipants !== null ? maximumParticipants - currentParticipantCount : null;
  const exceedsCapacity = remainingCapacity !== null && selected.size > remainingCapacity;

  function toggleEmployee(employeeId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(employeeId);
      else next.delete(employeeId);
      return next;
    });
  }

  function resetAndClose() {
    setSearch("");
    setSelected(new Set());
    setFormError(null);
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (selected.size === 0 || exceedsCapacity) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/training-classes/${trainingClassId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: [...selected] }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível adicionar os participantes.");
        return;
      }

      toast.success(
        selected.size === 1 ? "Participante adicionado." : `${selected.size} participantes adicionados.`,
      );
      onAdded();
      resetAndClose();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar participantes</DialogTitle>
          <DialogDescription>Selecione os colaboradores ativos que vão participar desta turma.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, documento ou matrícula..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
            />
          </div>

          <div className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border p-2">
            {filteredEmployees.length ? (
              filteredEmployees.map((employee) => {
                const alreadyIn = existingEmployeeIds.has(employee.id);
                return (
                  <Label
                    key={employee.id}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                      alreadyIn ? "opacity-50" : "hover:bg-muted/60"
                    }`}
                  >
                    <Checkbox
                      checked={alreadyIn || selected.has(employee.id)}
                      disabled={alreadyIn}
                      onCheckedChange={(checked) => toggleEmployee(employee.id, checked === true)}
                    />
                    <span className="flex-1">
                      {employee.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {employee.registration ?? employee.document}
                      </span>
                    </span>
                    {alreadyIn ? (
                      <span className="text-xs text-muted-foreground">Já está na turma</span>
                    ) : null}
                  </Label>
                );
              })
            ) : (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                Nenhum colaborador encontrado.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selecionado(s)</span>
            {remainingCapacity !== null ? (
              <span className={exceedsCapacity ? "font-medium text-destructive" : undefined}>
                {exceedsCapacity
                  ? "A turma atingiu a capacidade máxima."
                  : `${remainingCapacity} vaga(s) restante(s)`}
              </span>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={selected.size === 0 || exceedsCapacity || isSubmitting}
          >
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
