"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SstEmployeeTrainingStatus } from "@/lib/sst-employees";
import { SstEmployeeSummaryDialog } from "./sst-employee-summary-dialog";

const TRAINING_STATUS_LABEL: Record<SstEmployeeTrainingStatus, string> = {
  EM_DIA: "Em dia",
  ATENCAO: "Atenção",
  PENDENTE: "Pendente",
};

function TrainingStatusBadge({ status }: { status: SstEmployeeTrainingStatus }) {
  if (status === "PENDENTE") return <Badge variant="destructive">{TRAINING_STATUS_LABEL[status]}</Badge>;
  if (status === "ATENCAO") {
    return (
      <Badge
        variant="outline"
        className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
      >
        {TRAINING_STATUS_LABEL[status]}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
    >
      {TRAINING_STATUS_LABEL[status]}
    </Badge>
  );
}

type EmployeeRow = {
  id: string;
  name: string;
  documentMasked: string;
  registration: string | null;
  status: "ACTIVE" | "INACTIVE";
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  validCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  missingMandatoryCount: number;
  trainingStatus: SstEmployeeTrainingStatus;
};

const STATUS_FILTERS = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "INACTIVE", label: "Inativos" },
  { value: "ALL", label: "Todos" },
] as const;

export function SstEmployeesTable({
  companyId,
  employees,
  total,
  page,
  pageSize,
  canManage,
}: {
  companyId: string;
  employees: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasActiveFilters = Boolean(searchParams.get("q"));
  const currentStatus = searchParams.get("status") ?? "ACTIVE";
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  // Filtro "somente pendentes" continua local à página atual (não refaz a
  // consulta paginada no servidor) — mesma limitação já documentada antes
  // desta sprint (docs/demo-portal-consultoria-sst.md).
  const [onlyPending, setOnlyPending] = useState(false);
  const visibleEmployees = useMemo(
    () => (onlyPending ? employees.filter((employee) => employee.trainingStatus === "PENDENTE") : employees),
    [employees, onlyPending],
  );

  function statusFilterHref(status: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("status", status);
    next.set("page", "1");
    return `?${next.toString()}`;
  }

  async function handleToggleStatus(employee: EmployeeRow, event: React.MouseEvent) {
    event.stopPropagation();
    setPendingActionId(employee.id);
    const action = employee.status === "ACTIVE" ? "deactivate" : "reactivate";
    try {
      const response = await fetch(`/api/sst/companies/${companyId}/employees/${employee.id}/${action}`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        toast.error(data?.error ?? "Não foi possível concluir a ação.");
        return;
      }
      toast.success(action === "deactivate" ? "Colaborador inativado." : "Colaborador reativado.");
      router.refresh();
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearchInput placeholder="Buscar por nome, documento ou matrícula..." className="w-72" />
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por situação">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={currentStatus === filter.value ? "default" : "outline"}
              aria-pressed={currentStatus === filter.value}
              render={<Link href={statusFilterHref(filter.value)} />}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <Button variant={onlyPending ? "default" : "outline"} size="sm" onClick={() => setOnlyPending((prev) => !prev)}>
          Somente sem treinamento obrigatório
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Treinamento</TableHead>
              {canManage ? <TableHead className="text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEmployees.length ? (
              visibleEmployees.map((employee) => (
                <TableRow
                  key={employee.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelectedEmployee(employee)}
                >
                  <TableCell className="font-medium">{employee.name}</TableCell>
                  <TableCell className="font-mono text-xs">{employee.documentMasked}</TableCell>
                  <TableCell>{employee.department?.name ?? "—"}</TableCell>
                  <TableCell>{employee.position?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={employee.status === "ACTIVE" ? "default" : "outline"}>
                      {employee.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <TrainingStatusBadge status={employee.trainingStatus} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          render={<Link href={`/sst/companies/${companyId}/employees/${employee.id}/edit`} />}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pendingActionId === employee.id}
                          onClick={(event) => handleToggleStatus(employee, event)}
                        >
                          {employee.status === "ACTIVE" ? "Inativar" : "Reativar"}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6} className="h-40 text-center">
                  <div className="grid gap-2">
                    <p className="font-medium text-foreground">
                      {onlyPending
                        ? "Nenhum colaborador pendente nesta página. Ótimo sinal de conformidade."
                        : hasActiveFilters
                          ? "Nenhum colaborador encontrado para os filtros aplicados."
                          : "Nenhum colaborador cadastrado"}
                    </p>
                    {!hasActiveFilters && !onlyPending ? (
                      <p className="text-sm text-muted-foreground">
                        Cadastre o primeiro colaborador para iniciar a gestão de treinamentos e entregas de SST.
                      </p>
                    ) : null}
                    {canManage && !hasActiveFilters && !onlyPending ? (
                      <div>
                        <Button size="sm" render={<Link href={`/sst/companies/${companyId}/employees/new`} />}>
                          Cadastrar colaborador
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar page={page} pageSize={pageSize} total={total} />

      <SstEmployeeSummaryDialog
        companyId={companyId}
        employee={selectedEmployee}
        onOpenChange={(open) => !open && setSelectedEmployee(null)}
      />
    </div>
  );
}
