"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

type EmployeeOption = {
  id: string;
  name: string;
  document: string;
  registration: string | null;
  participantId: string | null;
  enrollmentStatus: "ENROLLED" | "CANCELLED" | null;
};

// Espelha app/(app)/trainings/classes/[id]/add-participants-dialog.tsx,
// apontando para /api/sst/* — busca/paginação server-side (Sprint SST 1.4G,
// §24) e documento já mascarado pela própria rota (§25).
export function SstAddParticipantsDialog({
  open,
  onOpenChange,
  companyId,
  trainingClassId,
  maximumParticipants,
  currentParticipantCount,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  trainingClassId: string;
  maximumParticipants: number | null;
  currentParticipantCount: number;
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseUrl = `/api/sst/companies/${companyId}/classes/${trainingClassId}`;

  async function loadPage(nextPage: number, searchTerm: string, append: boolean) {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
      if (searchTerm) params.set("q", searchTerm);
      const response = await fetch(`${baseUrl}/eligible-employees?${params.toString()}`);
      if (!response.ok) throw new Error("request_failed");
      const data = (await response.json()) as { employees: EmployeeOption[]; total: number };
      setEmployees((prev) => (append ? [...prev, ...data.employees] : data.employees));
      setTotal(data.total);
      setPage(nextPage);
    } catch {
      setFormError("Não foi possível carregar os colaboradores.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadPage(1, "", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadPage(1, search, false), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open]);

  const remainingCapacity = maximumParticipants !== null ? maximumParticipants - currentParticipantCount : null;
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
    setEmployees([]);
    onOpenChange(false);
  }

  async function handleSubmit() {
    if (selected.size === 0 || exceedsCapacity) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(`${baseUrl}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: [...selected] }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setFormError(data?.error ?? "Não foi possível adicionar os participantes.");
        return;
      }

      onAdded();
      resetAndClose();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasMore = employees.length < total;

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
            {isLoading && employees.length === 0 ? (
              <p className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Carregando…
              </p>
            ) : employees.length ? (
              <>
                {employees.map((employee) => {
                  const alreadyEnrolled = employee.enrollmentStatus === "ENROLLED";
                  const canReactivate = employee.enrollmentStatus === "CANCELLED";
                  return (
                    <Label
                      key={employee.id}
                      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                        alreadyEnrolled ? "opacity-50" : "hover:bg-muted/60"
                      }`}
                    >
                      <Checkbox
                        checked={alreadyEnrolled || selected.has(employee.id)}
                        disabled={alreadyEnrolled}
                        onCheckedChange={(checked) => toggleEmployee(employee.id, checked === true)}
                      />
                      <span className="flex-1">
                        {employee.name}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {employee.registration ?? employee.document}
                        </span>
                      </span>
                      {alreadyEnrolled ? (
                        <span className="text-xs text-muted-foreground">Já está na turma</span>
                      ) : canReactivate ? (
                        <Badge variant="outline" className="text-xs">
                          Removido — reativar
                        </Badge>
                      ) : null}
                    </Label>
                  );
                })}
                {hasMore ? (
                  <Button variant="ghost" size="sm" disabled={isLoading} onClick={() => loadPage(page + 1, search, true)}>
                    {isLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                    Carregar mais
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nenhum colaborador encontrado.</p>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selecionado(s)</span>
            {remainingCapacity !== null ? (
              <span className={exceedsCapacity ? "font-medium text-destructive" : undefined}>
                {exceedsCapacity ? "A turma atingiu a capacidade máxima." : `${remainingCapacity} vaga(s) restante(s)`}
              </span>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={selected.size === 0 || exceedsCapacity || isSubmitting}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
