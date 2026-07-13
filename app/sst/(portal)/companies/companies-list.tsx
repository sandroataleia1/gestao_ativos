"use client";

import { useMemo, useState } from "react";
import { BuildingIcon, CheckIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SstLinkedCompanySummary } from "@/lib/sst-dashboard";
import { pluralize } from "@/lib/plural";
import { filterCompaniesForList } from "@/lib/sst-companies-list";
import { CompanyListItem } from "./company-list-item";

const STATUS_FILTER_VALUES = ["ALL", "EM_DIA", "ATENCAO", "CRITICA"] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "Todas as situações",
  EM_DIA: "Em dia",
  ATENCAO: "Atenção",
  CRITICA: "Crítica",
};

const PAGE_SIZE = 12;

export function SstCompaniesList({ companies }: { companies: SstLinkedCompanySummary[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [onlyWithPendency, setOnlyWithPendency] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(
    () => filterCompaniesForList(companies, { search, statusFilter, onlyWithPendency }),
    [companies, search, statusFilter, onlyWithPendency],
  );

  const visible = filtered.slice(0, visibleCount);
  const hasActiveFilters = search.trim() !== "" || statusFilter !== "ALL" || onlyWithPendency;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Buscar empresa por nome..."
            aria-label="Buscar empresa por nome"
            className="pl-8"
          />
        </div>
        <Select
          items={STATUS_FILTER_LABELS}
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as StatusFilter);
            setVisibleCount(PAGE_SIZE);
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_FILTER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={onlyWithPendency ? "default" : "outline"}
          aria-pressed={onlyWithPendency}
          onClick={() => {
            setOnlyWithPendency((prev) => !prev);
            setVisibleCount(PAGE_SIZE);
          }}
        >
          {onlyWithPendency ? <CheckIcon /> : null}
          Somente com pendências
        </Button>
      </div>

      {hasActiveFilters ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Filtros aplicados.</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => {
              setSearch("");
              setStatusFilter("ALL");
              setOnlyWithPendency(false);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            Limpar filtros
          </Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BuildingIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">
              {hasActiveFilters ? "Nenhuma empresa encontrada com esses filtros." : "Nenhuma empresa autorizada ainda."}
            </p>
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? "Ajuste a busca ou os filtros para ver outras empresas."
                : "Peça para uma empresa autorizar sua consultoria em Configurações → Prestadores SST."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Grid responsivo — usa a largura disponível em telas largas em
              vez de uma coluna única esticada com espaço em branco ao lado
              (2 colunas a partir de lg, 3 em telas bem largas; 1 coluna no
              mobile, empilhado). */}
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visible.map((company) => (
              <li key={company.companyId}>
                <CompanyListItem company={company} />
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {visibleCount < filtered.length
                ? `Mostrando 1–${visible.length} de ${pluralize(filtered.length, "empresa", "empresas")}`
                : pluralize(filtered.length, "empresa encontrada", "empresas encontradas")}
            </span>
            {visibleCount < filtered.length ? (
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}>
                Carregar mais
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
