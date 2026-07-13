"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";

import type { Alert, AlertType } from "@/lib/alerts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SEVERITY_LABEL: Record<Alert["severity"], string> = {
  CRITICAL: "Crítico",
  WARNING: "Atenção",
  INFO: "Info",
};

const SEVERITY_BADGE_VARIANT: Record<Alert["severity"], "destructive" | "outline"> = {
  CRITICAL: "destructive",
  WARNING: "outline",
  INFO: "outline",
};

const CATEGORY_BY_TYPE: Record<AlertType, { label: string; href: string; filterKey: FilterKey }> = {
  CA_EXPIRED: { label: "Certificações", href: "/reports", filterKey: "certifications" },
  CA_EXPIRING_SOON: { label: "Certificações", href: "/reports", filterKey: "certifications" },
  CUSTODY_OVERDUE: { label: "Entregas", href: "/custodies", filterKey: "custody" },
  LOW_STOCK: { label: "Estoque", href: "/stock", filterKey: "stock" },
};

type FilterKey = "all" | "critical" | "custody" | "stock" | "certifications";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "critical", label: "Críticas" },
  { key: "custody", label: "Entregas" },
  { key: "stock", label: "Estoque" },
  { key: "certifications", label: "Certificações" },
];

function matchesFilter(alert: Alert, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "critical") return alert.severity === "CRITICAL";
  return CATEGORY_BY_TYPE[alert.type].filterKey === filter;
}

// O dashboard é um resumo, não a central de alertas completa (/alerts já
// existe para isso) — sem limite, uma empresa com centenas de pendências
// (ex.: base de demonstração em volume) travaria a página renderizando
// milhares de linhas. "Ver todas" no cabeçalho do card leva à lista
// completa e filtrável.
const VISIBLE_LIMIT = 8;

export function PriorityAlerts({ alerts }: { alerts: Alert[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const filtered = useMemo(() => alerts.filter((alert) => matchesFilter(alert, filter)), [alerts, filter]);
  const visible = filtered.slice(0, VISIBLE_LIMIT);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
        <span>Tudo certo. Nenhuma pendência prioritária no momento.</span>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar pendências prioritárias">
        {FILTERS.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={filter === key ? "default" : "outline"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pendência nesta categoria.</p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((alert) => {
            const category = CATEGORY_BY_TYPE[alert.type];
            return (
              <li key={alert.id}>
                <Link
                  href={category.href}
                  className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2.5">
                    <Badge variant={SEVERITY_BADGE_VARIANT[alert.severity]} className="w-fit">
                      {SEVERITY_LABEL[alert.severity]}
                    </Badge>
                    <span className="font-medium">{alert.title}</span>
                    <span className="text-xs text-muted-foreground">{alert.description}</span>
                  </span>
                  <Badge variant="outline" className="w-fit shrink-0">
                    {category.label}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > VISIBLE_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Mostrando {visible.length} de {filtered.length}
          {" "}
          pendências. Use o link &quot;Ver todas&quot; acima para a lista completa.
        </p>
      ) : null}
    </div>
  );
}
