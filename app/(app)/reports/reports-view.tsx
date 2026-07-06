"use client";

import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DownloadIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/csv";
import { formatDateOnlyBR } from "@/lib/date-only";
import type {
  AssetsReportData,
  CustodiesReportData,
  ExpiringCaReportData,
  ReportFilters,
  ReportLookups,
  ReportTab,
  StockReportData,
} from "./types";

const ALL_VALUE = "all";

const TAB_LABEL: Record<ReportTab, string> = {
  assets: "Ativos",
  stock: "Estoque",
  custodies: "Custódias",
  ca: "CAs a vencer",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

export function ReportsView({
  tab,
  filters,
  report,
  lookups,
}: {
  tab: ReportTab;
  filters: ReportFilters;
  report: AssetsReportData | StockReportData | CustodiesReportData | ExpiringCaReportData;
  lookups: ReportLookups;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilters(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === ALL_VALUE) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function changeTab(nextTab: string | null) {
    if (!nextTab) return;
    router.push(`${pathname}?tab=${nextTab}`);
  }

  return (
    <div className="grid gap-4">
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          {(Object.keys(TAB_LABEL) as ReportTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FiltersBar tab={tab} filters={filters} lookups={lookups} onChange={applyFilters} />

      {tab === "assets" ? <AssetsReportView report={report as AssetsReportData} /> : null}
      {tab === "stock" ? <StockReportView report={report as StockReportData} /> : null}
      {tab === "custodies" ? <CustodiesReportView report={report as CustodiesReportData} /> : null}
      {tab === "ca" ? <ExpiringCaReportView report={report as ExpiringCaReportData} /> : null}
    </div>
  );
}

function FiltersBar({
  tab,
  filters,
  lookups,
  onChange,
}: {
  tab: ReportTab;
  filters: ReportFilters;
  lookups: ReportLookups;
  onChange: (next: Record<string, string | undefined>) => void;
}) {
  const [dateFrom, setDateFrom] = useState(filters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(filters.dateTo ?? "");
  const [withinDays, setWithinDays] = useState(filters.withinDays ?? "30");

  function applyDates(event: FormEvent) {
    event.preventDefault();
    onChange({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
  }

  function applyWithinDays(event: FormEvent) {
    event.preventDefault();
    onChange({ withinDays: withinDays || undefined });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      {tab === "assets" || tab === "stock" || tab === "ca" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Categoria</Label>
          <Select
            items={{
              [ALL_VALUE]: "Todas",
              ...Object.fromEntries(lookups.categories.map((c) => [c.id, c.name])),
            }}
            value={filters.categoryId ?? ALL_VALUE}
            onValueChange={(value) => onChange({ categoryId: (value as string) ?? undefined })}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todas</SelectItem>
              {lookups.categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tab === "assets" ? (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              items={{
                [ALL_VALUE]: "Todos",
                ...Object.fromEntries(lookups.statuses.map((s) => [s.id, s.name])),
              }}
              value={filters.statusId ?? ALL_VALUE}
              onValueChange={(value) => onChange({ statusId: (value as string) ?? undefined })}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                {lookups.statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Condição</Label>
            <Select
              items={{
                [ALL_VALUE]: "Todas",
                ...Object.fromEntries(lookups.conditions.map((c) => [c.id, c.name])),
              }}
              value={filters.conditionId ?? ALL_VALUE}
              onValueChange={(value) => onChange({ conditionId: (value as string) ?? undefined })}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Condição" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todas</SelectItem>
                {lookups.conditions.map((condition) => (
                  <SelectItem key={condition.id} value={condition.id}>
                    {condition.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}

      {tab === "assets" || tab === "stock" || tab === "custodies" || tab === "ca" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Ativo</Label>
          <Select
            items={{
              [ALL_VALUE]: "Todos",
              ...Object.fromEntries(lookups.assets.map((a) => [a.id, `${a.name} (${a.assetCode})`])),
            }}
            value={filters.assetId ?? ALL_VALUE}
            onValueChange={(value) => onChange({ assetId: (value as string) ?? undefined })}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Ativo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {lookups.assets.map((asset) => (
                <SelectItem key={asset.id} value={asset.id}>
                  {asset.name} ({asset.assetCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tab === "stock" || tab === "custodies" ? (
        <div className="grid gap-1.5">
          <Label className="text-xs">Local</Label>
          <Select
            items={{
              [ALL_VALUE]: "Todos",
              ...Object.fromEntries(lookups.locations.map((l) => [l.id, l.name])),
            }}
            value={filters.locationId ?? ALL_VALUE}
            onValueChange={(value) => onChange({ locationId: (value as string) ?? undefined })}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Local" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {lookups.locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tab === "custodies" ? (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Colaborador</Label>
            <Select
              items={{
                [ALL_VALUE]: "Todos",
                ...Object.fromEntries(lookups.employees.map((e) => [e.id, e.name])),
              }}
              value={filters.employeeId ?? ALL_VALUE}
              onValueChange={(value) => onChange({ employeeId: (value as string) ?? undefined })}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Colaborador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                {lookups.employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              items={{ [ALL_VALUE]: "Todos", ACTIVE: "Ativa", RETURNED: "Devolvida" }}
              value={filters.status ?? ALL_VALUE}
              onValueChange={(value) => onChange({ status: (value as string) ?? undefined })}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                <SelectItem value="ACTIVE">Ativa</SelectItem>
                <SelectItem value="RETURNED">Devolvida</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}

      {tab === "assets" || tab === "custodies" ? (
        <form onSubmit={applyDates} className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">{tab === "assets" ? "Cadastrado de" : "Entregue de"}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-8 w-36"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">até</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-8 w-36"
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Aplicar período
          </Button>
        </form>
      ) : null}

      {tab === "ca" ? (
        <form onSubmit={applyWithinDays} className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Vencendo em até (dias)</Label>
            <Input
              type="number"
              min="1"
              value={withinDays}
              onChange={(event) => setWithinDays(event.target.value)}
              className="h-8 w-28"
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Aplicar
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="grid gap-1 text-sm">
            {items.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-4">
                <span className="truncate">{item.label}</span>
                <span className="font-medium">{item.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportTable<T>({
  title,
  onExport,
  headers,
  rows,
  renderRow,
}: {
  title: string;
  onExport: () => void;
  headers: string[];
  rows: T[];
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {title} ({rows.length})
        </h2>
        <Button size="sm" variant="outline" onClick={onExport} disabled={rows.length === 0}>
          <DownloadIcon />
          Exportar CSV
        </Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map(renderRow)
            ) : (
              <TableRow>
                <TableCell colSpan={headers.length} className="h-24 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AssetsReportView({ report }: { report: AssetsReportData }) {
  function exportCsv() {
    downloadCsv(
      "relatorio-ativos.csv",
      report.rows.map((row) => ({
        Nome: row.name,
        Código: row.assetCode,
        Categoria: row.category,
        Status: row.status,
        Condição: row.condition,
        Controle: row.trackingMode === "INDIVIDUAL" ? "Série" : "Quantidade",
        Ativo: row.active ? "Sim" : "Não",
        "Cadastrado em": formatDate(row.createdAt),
      })),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total de ativos" value={report.summary.total} />
        <SummaryCard label="Ativos" value={report.summary.active} />
        <SummaryCard label="Inativos" value={report.summary.inactive} />
        <SummaryCard label="Categorias" value={report.summary.byCategory.length} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <BreakdownCard title="Por categoria" items={report.summary.byCategory} />
        <BreakdownCard title="Por status" items={report.summary.byStatus} />
        <BreakdownCard title="Por condição" items={report.summary.byCondition} />
      </div>

      <ReportTable
        title="Ativos"
        onExport={exportCsv}
        headers={["Nome", "Código", "Categoria", "Status", "Condição", "Ativo"]}
        rows={report.rows}
        renderRow={(row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.assetCode}</TableCell>
            <TableCell>{row.category}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell>{row.condition}</TableCell>
            <TableCell>
              <Badge variant={row.active ? "default" : "outline"}>
                {row.active ? "Ativo" : "Inativo"}
              </Badge>
            </TableCell>
          </TableRow>
        )}
      />
    </div>
  );
}

function StockReportView({ report }: { report: StockReportData }) {
  function exportCsv() {
    downloadCsv(
      "relatorio-estoque.csv",
      report.rows.map((row) => ({
        Ativo: row.asset.name,
        Código: row.asset.assetCode,
        Categoria: row.asset.category.name,
        Local: row.location.name,
        Controle: row.asset.trackingMode === "INDIVIDUAL" ? "Série" : "Quantidade",
        Quantidade: row.quantity,
      })),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Ativos em estoque" value={report.summary.distinctAssets} />
        <SummaryCard label="Locais" value={report.summary.distinctLocations} />
        <SummaryCard label="Qtde. consumíveis" value={report.summary.consumableQuantity} />
        <SummaryCard label="Unidades individuais" value={report.summary.individualUnits} />
      </div>

      <ReportTable
        title="Saldo de estoque"
        onExport={exportCsv}
        headers={["Ativo", "Código", "Categoria", "Local", "Controle", "Quantidade"]}
        rows={report.rows}
        renderRow={(row) => (
          <TableRow key={`${row.assetId}-${row.locationId}`}>
            <TableCell>{row.asset.name}</TableCell>
            <TableCell>{row.asset.assetCode}</TableCell>
            <TableCell>{row.asset.category.name}</TableCell>
            <TableCell>{row.location.name}</TableCell>
            <TableCell>
              <Badge variant="outline">
                {row.asset.trackingMode === "INDIVIDUAL" ? "Série" : "Quantidade"}
              </Badge>
            </TableCell>
            <TableCell className="font-medium">
              {row.quantity}
              {row.asset.defaultUnit ? ` ${row.asset.defaultUnit}` : ""}
            </TableCell>
          </TableRow>
        )}
      />
    </div>
  );
}

function CustodiesReportView({ report }: { report: CustodiesReportData }) {
  function exportCsv() {
    downloadCsv(
      "relatorio-custodias.csv",
      report.rows.map((row) => ({
        Colaborador: row.employee.name,
        Ativo: row.asset.name,
        Código: row.asset.assetCode,
        "Unidade/Quantidade": row.assetUnit
          ? (row.assetUnit.serialNumber ?? row.assetUnit.patrimonyNumber ?? "—")
          : `${row.quantity}${row.asset.defaultUnit ? ` ${row.asset.defaultUnit}` : ""}`,
        Status: row.status === "ACTIVE" ? "Ativa" : "Devolvida",
        Atrasada: row.overdue ? "Sim" : "Não",
        "Entregue em": formatDate(row.deliveredAt),
        "Devolvido em": formatDate(row.returnedAt),
      })),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total no filtro" value={report.summary.total} />
        <SummaryCard label="Ativas" value={report.summary.active} />
        <SummaryCard label="Atrasadas" value={report.summary.overdue} />
        <SummaryCard label="Colaboradores" value={report.summary.byEmployee.length} />
      </div>

      <BreakdownCard
        title="Itens em posse por colaborador"
        items={report.summary.byEmployee.map((employee) => ({
          label: employee.name,
          count: employee.quantity,
        }))}
      />

      <ReportTable
        title="Custódias"
        onExport={exportCsv}
        headers={["Colaborador", "Ativo", "Unidade/Quantidade", "Status", "Entregue em", "Devolvido em"]}
        rows={report.rows}
        renderRow={(row) => (
          <TableRow key={row.id}>
            <TableCell>{row.employee.name}</TableCell>
            <TableCell>{row.asset.name}</TableCell>
            <TableCell>
              {row.assetUnit
                ? (row.assetUnit.serialNumber ?? row.assetUnit.patrimonyNumber ?? "—")
                : `${row.quantity}${row.asset.defaultUnit ? ` ${row.asset.defaultUnit}` : ""}`}
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Badge variant={row.status === "ACTIVE" ? "default" : "outline"}>
                  {row.status === "ACTIVE" ? "Ativa" : "Devolvida"}
                </Badge>
                {row.overdue ? <Badge variant="destructive">Atrasada</Badge> : null}
              </div>
            </TableCell>
            <TableCell>{formatDate(row.deliveredAt)}</TableCell>
            <TableCell>{formatDate(row.returnedAt)}</TableCell>
          </TableRow>
        )}
      />
    </div>
  );
}

function ExpiringCaReportView({ report }: { report: ExpiringCaReportData }) {
  function exportCsv() {
    downloadCsv(
      "relatorio-ca-vencimento.csv",
      report.rows.map((row) => ({
        Ativo: row.assetName,
        Código: row.assetCode,
        Categoria: row.category,
        "Nº do CA": row.certificationNumber,
        "Órgão emissor": row.issuer ?? "—",
        Vencimento: formatDateOnlyBR(row.expirationDate),
        Situação: row.bucket === "EXPIRED" ? "Vencido" : "Próximo do vencimento",
      })),
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total" value={report.summary.total} />
        <SummaryCard label="Vencidos" value={report.summary.expired} />
        <SummaryCard label="Próximos do vencimento" value={report.summary.expiringSoon} />
      </div>

      <ReportTable
        title="Certificados de Aprovação (CA)"
        onExport={exportCsv}
        headers={["Ativo", "Código", "Nº do CA", "Órgão emissor", "Vencimento", "Situação"]}
        rows={report.rows}
        renderRow={(row) => (
          <TableRow key={row.id}>
            <TableCell>{row.assetName}</TableCell>
            <TableCell>{row.assetCode}</TableCell>
            <TableCell>{row.certificationNumber}</TableCell>
            <TableCell>{row.issuer ?? "—"}</TableCell>
            <TableCell>{formatDateOnlyBR(row.expirationDate)}</TableCell>
            <TableCell>
              <Badge variant={row.bucket === "EXPIRED" ? "destructive" : "outline"}>
                {row.bucket === "EXPIRED" ? "Vencido" : "Próximo do vencimento"}
              </Badge>
            </TableCell>
          </TableRow>
        )}
      />
    </div>
  );
}
