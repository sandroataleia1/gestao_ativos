"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Alert, AlertResourceType, AlertSeverity, AlertType } from "@/lib/alerts";

const ALL_VALUE = "all";

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  CRITICAL: "Crítico",
  WARNING: "Atenção",
  INFO: "Informativo",
};

const TYPE_LABEL: Record<AlertType, string> = {
  CA_EXPIRED: "CA vencido",
  CA_EXPIRING_SOON: "CA a vencer",
  CUSTODY_OVERDUE: "Devolução atrasada",
  LOW_STOCK: "Estoque baixo",
};

const RESOURCE_HREF: Record<AlertResourceType, string> = {
  ASSET: "/assets",
  CUSTODY: "/custodies",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export function AlertsView({ initialAlerts }: { initialAlerts: Alert[] }) {
  const [severity, setSeverity] = useState(ALL_VALUE);
  const [type, setType] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    return initialAlerts.filter((alert) => {
      if (severity !== ALL_VALUE && alert.severity !== severity) return false;
      if (type !== ALL_VALUE && alert.type !== type) return false;
      return true;
    });
  }, [initialAlerts, severity, type]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={{ [ALL_VALUE]: "Todas as severidades", ...SEVERITY_LABEL }}
          value={severity}
          onValueChange={(value) => setSeverity((value as string) ?? ALL_VALUE)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Severidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todas as severidades</SelectItem>
            {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={{ [ALL_VALUE]: "Todos os tipos", ...TYPE_LABEL }}
          value={type}
          onValueChange={(value) => setType((value as string) ?? ALL_VALUE)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos os tipos</SelectItem>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severidade</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Alerta</TableHead>
              <TableHead>Detectado em</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell>
                    <Badge
                      variant={
                        alert.severity === "CRITICAL"
                          ? "destructive"
                          : alert.severity === "WARNING"
                            ? "default"
                            : "outline"
                      }
                    >
                      {SEVERITY_LABEL[alert.severity]}
                    </Badge>
                  </TableCell>
                  <TableCell>{TYPE_LABEL[alert.type]}</TableCell>
                  <TableCell>
                    <div className="grid">
                      <span className="font-medium">{alert.title}</span>
                      <span className="text-xs text-muted-foreground">{alert.description}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(alert.detectedAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={RESOURCE_HREF[alert.resourceType]}
                      className="text-sm font-medium text-primary underline underline-offset-4"
                    >
                      Ver recurso
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {initialAlerts.length ? (
                    "Nenhum alerta encontrado para os filtros aplicados."
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                      <span>Nenhum alerta no momento. Tudo em dia.</span>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
