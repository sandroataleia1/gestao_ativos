"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SstEmployeeTrainingStatus } from "@/lib/sst-employees";
import { SstEmployeeSummaryDialog } from "./sst-employee-summary-dialog";

const STATUS_LABEL: Record<SstEmployeeTrainingStatus, string> = {
  EM_DIA: "Em dia",
  ATENCAO: "Atenção",
  PENDENTE: "Pendente",
};

function StatusBadge({ status }: { status: SstEmployeeTrainingStatus }) {
  if (status === "PENDENTE") return <Badge variant="destructive">{STATUS_LABEL[status]}</Badge>;
  if (status === "ATENCAO") {
    return (
      <Badge
        variant="outline"
        className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
      >
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

type EmployeeRow = {
  id: string;
  name: string;
  document: string;
  registration: string | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  validCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  missingMandatoryCount: number;
  status: SstEmployeeTrainingStatus;
};

export function SstEmployeesTable({
  companyId,
  employees,
  total,
  page,
  pageSize,
}: {
  companyId: string;
  employees: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const searchParams = useSearchParams();
  const hasActiveFilters = Boolean(searchParams.get("q"));
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  // Filtro "somente pendentes" é local à página atual (não refaz a consulta
  // paginada no servidor) — aceitável nesta sprint porque o volume por
  // empresa de demonstração é pequeno; para empresas com muitas páginas de
  // colaboradores isso só filtra dentro da página carregada (limitação
  // documentada, ver docs/demo-portal-consultoria-sst.md).
  const [onlyPending, setOnlyPending] = useState(false);
  const visibleEmployees = useMemo(
    () => (onlyPending ? employees.filter((employee) => employee.status === "PENDENTE") : employees),
    [employees, onlyPending],
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DebouncedSearchInput placeholder="Buscar por nome, documento ou matrícula..." className="w-72" />
        <Button variant={onlyPending ? "default" : "outline"} size="sm" onClick={() => setOnlyPending((prev) => !prev)}>
          Somente sem treinamento obrigatório
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Válidos</TableHead>
              <TableHead>Vencidos</TableHead>
              <TableHead>Vencendo</TableHead>
              <TableHead>Obrigatórios ausentes</TableHead>
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
                  <TableCell>{employee.registration ?? employee.document}</TableCell>
                  <TableCell>{employee.department?.name ?? "—"}</TableCell>
                  <TableCell>{employee.position?.name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={employee.status} />
                  </TableCell>
                  <TableCell>{employee.validCount}</TableCell>
                  <TableCell>{employee.expiredCount}</TableCell>
                  <TableCell>{employee.expiringSoonCount}</TableCell>
                  <TableCell>{employee.missingMandatoryCount}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                  {onlyPending
                    ? "Nenhum colaborador pendente nesta página. Ótimo sinal de conformidade."
                    : hasActiveFilters
                      ? "Nenhum colaborador encontrado para os filtros aplicados."
                      : "Nenhum colaborador ativo cadastrado nesta empresa."}
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
