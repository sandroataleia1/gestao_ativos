"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServerSortableHeader } from "@/components/ui/data-table-column-header";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TrainingSortField } from "@/lib/trainings";
import type { TrainingManagementLabel } from "@/lib/sst-trainings";

const TRAINING_TYPE_LABELS: Record<string, string> = { LEGAL: "Legal", CORPORATE: "Corporativo" };

const MANAGEMENT_LABEL_TEXT: Record<TrainingManagementLabel, string> = {
  MANAGED_BY_THIS_PROVIDER: "Gerenciado por esta consultoria",
  MANAGED_INTERNALLY: "Gerenciado internamente",
  MANAGED_BY_OTHER_PROVIDER: "Gerenciado por outro prestador",
  PROVIDER_WITHOUT_ACTIVE_LINK: "Prestador sem vínculo ativo",
};

function ManagementBadge({ label }: { label: TrainingManagementLabel }) {
  if (label === "MANAGED_BY_THIS_PROVIDER") return <Badge>{MANAGEMENT_LABEL_TEXT[label]}</Badge>;
  if (label === "PROVIDER_WITHOUT_ACTIVE_LINK") return <Badge variant="destructive">{MANAGEMENT_LABEL_TEXT[label]}</Badge>;
  return <Badge variant="outline">{MANAGEMENT_LABEL_TEXT[label]}</Badge>;
}

type TrainingRow = {
  id: string;
  title: string;
  category: string | null;
  trainingType: string;
  validityMonths: number | null;
  mandatory: boolean;
  active: boolean;
  managementLabel: TrainingManagementLabel;
};

export function SstTrainingsTable({
  companyId,
  trainings,
  total,
  page,
  pageSize,
  sort,
  dir,
  canAdminister,
  canOperate,
}: {
  companyId: string;
  trainings: TrainingRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: TrainingSortField;
  dir: "asc" | "desc";
  canAdminister: boolean;
  canOperate: boolean;
}) {
  const searchParams = useSearchParams();
  const hasActiveFilters = Boolean(searchParams.get("q"));

  const headerFor = (field: TrainingSortField, label: string) => (
    <ServerSortableHeader field={field} label={label} currentField={sort} currentDir={dir} />
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DebouncedSearchInput placeholder="Buscar por título ou categoria..." className="w-72" />
        {canAdminister ? (
          <Button render={<Link href={`/sst/companies/${companyId}/trainings/new`} />}>
            <PlusIcon />
            Novo treinamento
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{headerFor("title", "Título")}</TableHead>
              <TableHead>{headerFor("category", "Categoria")}</TableHead>
              <TableHead>{headerFor("trainingType", "Tipo")}</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>{headerFor("mandatory", "Obrigatório")}</TableHead>
              <TableHead>{headerFor("active", "Status")}</TableHead>
              <TableHead>Gestão</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {trainings.length ? (
              trainings.map((training) => (
                <TableRow key={training.id}>
                  <TableCell>{training.title}</TableCell>
                  <TableCell>{training.category ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TRAINING_TYPE_LABELS[training.trainingType]}</Badge>
                  </TableCell>
                  <TableCell>{training.validityMonths ? `${training.validityMonths} meses` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={training.mandatory ? "default" : "outline"}>
                      {training.mandatory ? "Obrigatório" : "Opcional"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={training.active ? "default" : "outline"}>
                      {training.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ManagementBadge label={training.managementLabel} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {training.managementLabel === "MANAGED_BY_THIS_PROVIDER" && canAdminister ? (
                        <Button
                          size="sm"
                          variant="outline"
                          render={<Link href={`/sst/companies/${companyId}/trainings/${training.id}/edit`} />}
                        >
                          Editar
                        </Button>
                      ) : null}
                      {training.managementLabel === "MANAGED_BY_THIS_PROVIDER" && canOperate ? (
                        <Button
                          size="sm"
                          render={<Link href={`/sst/companies/${companyId}/classes/new?trainingId=${training.id}`} />}
                        >
                          Criar turma
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>
                      {hasActiveFilters
                        ? "Nenhum treinamento encontrado para os filtros aplicados."
                        : "Esta empresa ainda não possui treinamentos cadastrados."}
                    </p>
                    {canAdminister && !hasActiveFilters ? (
                      <Button size="sm" render={<Link href={`/sst/companies/${companyId}/trainings/new`} />}>
                        <PlusIcon />
                        Novo treinamento
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
