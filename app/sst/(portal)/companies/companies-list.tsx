"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BuildingIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComplianceStatusBadge } from "@/app/sst/compliance-badge";
import type { SstLinkedCompanySummary } from "@/lib/sst-dashboard";

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  VIEW: "Somente consulta",
  OPERATION: "Operação",
  ADMINISTRATION: "Administração",
};

const RELATIONSHIP_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  PENDING: "Pendente",
  SUSPENDED: "Suspenso",
  REVOKED: "Revogado",
};

const STATUS_FILTER_VALUES = ["ALL", "EM_DIA", "ATENCAO", "CRITICA"] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "Todas as situações",
  EM_DIA: "Em dia",
  ATENCAO: "Atenção",
  CRITICA: "Crítica",
};

const PAGE_SIZE = 12;

function hasPendency(company: SstLinkedCompanySummary): boolean {
  return company.expiredCount > 0 || company.missingMandatoryCount > 0 || company.expiringSoonCount > 0;
}

export function SstCompaniesList({ companies }: { companies: SstLinkedCompanySummary[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [onlyWithPendency, setOnlyWithPendency] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return companies.filter((company) => {
      if (normalizedSearch && !company.companyName.toLowerCase().includes(normalizedSearch)) return false;
      if (statusFilter !== "ALL" && company.complianceStatus !== statusFilter) return false;
      if (onlyWithPendency && !hasPendency(company)) return false;
      return true;
    });
  }, [companies, search, statusFilter, onlyWithPendency]);

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
          <SelectTrigger className="w-full sm:w-48">
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
          onClick={() => {
            setOnlyWithPendency((prev) => !prev);
            setVisibleCount(PAGE_SIZE);
          }}
        >
          Somente com pendências
        </Button>
      </div>

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
            {hasActiveFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                  setOnlyWithPendency(false);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                Limpar filtros
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3">
            {visible.map((company) => (
              <li key={company.companyId}>
                <Card>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{company.companyName}</span>
                        <ComplianceStatusBadge status={company.complianceStatus} />
                        <Badge variant="outline">
                          {RELATIONSHIP_STATUS_LABELS[company.relationshipStatus] ?? company.relationshipStatus}
                        </Badge>
                        <Badge variant="secondary">
                          {ACCESS_LEVEL_LABELS[company.accessLevel] ?? company.accessLevel}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{company.activeEmployeeCount} colaborador(es) ativo(s)</span>
                        <span>{company.activeTrainingCount} treinamento(s)</span>
                        <span>{company.expiredCount} vencido(s)</span>
                        <span>{company.expiringSoonCount} vencendo em 30 dias</span>
                        <span>{company.missingMandatoryCount} sem treinamento obrigatório</span>
                        <span>{company.scheduledClassCount} turma(s) agendada(s)</span>
                        <span>Índice: {company.complianceScore}%</span>
                      </div>
                    </div>
                    <Button size="sm" render={<Link href={`/sst/companies/${company.companyId}`} />}>
                      Abrir empresa
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Mostrando {visible.length} de {filtered.length} empresa(s)
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
