import type { Metadata } from "next";
import Link from "next/link";

import { listDistinctPlatformAuditActions, listPlatformAuditLogs } from "@/lib/platform-audit-listing";
import { parsePageParams, type SearchParamsInput } from "@/lib/pagination";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Auditoria da plataforma — Administração",
};

const SEVERITY_FILTERS = ["ALL", "INFO", "WARNING", "CRITICAL"] as const;
const SEVERITY_BADGE_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  INFO: "outline",
  WARNING: "secondary",
  CRITICAL: "destructive",
};

function formatDate(date: Date) {
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseDateParam(value: string | string[] | undefined): Date | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// Sprint SST 1.4D.1, §12 — página simples, SOMENTE LEITURA, sobre
// PlatformAuditLog (auditoria persistente das ações GLOBAIS da
// plataforma). Nunca exibe metadata bruta, CNPJ integral, token, cookie ou
// dado operacional de cliente — só os campos já sanitizados pela camada de
// listagem (lib/platform-audit-listing.ts). Protegida pelo mesmo
// requirePlatformRoleOrDeny("SUPER_ADMIN") do layout deste portal.
export default async function PlatformAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize } = parsePageParams(resolvedSearchParams, { defaultPageSize: 25 });

  const rawAction = resolvedSearchParams.action;
  const action = (Array.isArray(rawAction) ? rawAction[0] : rawAction) || undefined;

  const rawSeverity = resolvedSearchParams.severity;
  const severityParam = (Array.isArray(rawSeverity) ? rawSeverity[0] : rawSeverity) ?? "ALL";
  const severity = (SEVERITY_FILTERS as readonly string[]).includes(severityParam)
    ? (severityParam as (typeof SEVERITY_FILTERS)[number])
    : "ALL";

  const since = parseDateParam(resolvedSearchParams.since);
  const until = parseDateParam(resolvedSearchParams.until);

  const [result, actions] = await Promise.all([
    listPlatformAuditLogs({ action, severity, since, until, page, pageSize }),
    listDistinctPlatformAuditActions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));

  function pageHref(overrides: Record<string, string | number>) {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    params.set("severity", severity);
    if (resolvedSearchParams.since) params.set("since", String(resolvedSearchParams.since));
    if (resolvedSearchParams.until) params.set("until", String(resolvedSearchParams.until));
    params.set("page", String(page));
    for (const [key, value] of Object.entries(overrides)) params.set(key, String(value));
    return `/platform-admin/audit?${params.toString()}`;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Auditoria da plataforma</h1>
        <p className="text-sm text-zinc-400">
          Registro histórico append-only de ações GLOBAIS do Portal Super Admin — bootstrap, concessão/revogação de
          acesso, tentativas não autorizadas e execução de diagnósticos. Decisões sobre reivindicações específicas
          aparecem na linha do tempo de cada reivindicação.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/platform-admin/audit" method="get">
        <div className="grid gap-1">
          <label className="text-xs text-zinc-400" htmlFor="action">
            Ação
          </label>
          <select
            id="action"
            name="action"
            defaultValue={action ?? ""}
            className="h-9 rounded-md border border-white/15 bg-white/5 px-2 text-sm text-zinc-50"
          >
            <option value="">Todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-zinc-400" htmlFor="severity">
            Severidade
          </label>
          <select
            id="severity"
            name="severity"
            defaultValue={severity}
            className="h-9 rounded-md border border-white/15 bg-white/5 px-2 text-sm text-zinc-50"
          >
            {SEVERITY_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "Todas" : s}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-zinc-400" htmlFor="since">
            Desde
          </label>
          <input
            id="since"
            type="datetime-local"
            name="since"
            defaultValue={typeof resolvedSearchParams.since === "string" ? resolvedSearchParams.since : ""}
            className="h-9 rounded-md border border-white/15 bg-white/5 px-2 text-sm text-zinc-50"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-zinc-400" htmlFor="until">
            Até
          </label>
          <input
            id="until"
            type="datetime-local"
            name="until"
            defaultValue={typeof resolvedSearchParams.until === "string" ? resolvedSearchParams.until : ""}
            className="h-9 rounded-md border border-white/15 bg-white/5 px-2 text-sm text-zinc-50"
          />
        </div>
        <Button type="submit" variant="outline" className="border-white/15 text-zinc-200 hover:bg-white/10">
          Filtrar
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-zinc-400">Ação</TableHead>
              <TableHead className="text-zinc-400">Severidade</TableHead>
              <TableHead className="text-zinc-400">Origem</TableHead>
              <TableHead className="text-zinc-400">Ator</TableHead>
              <TableHead className="text-zinc-400">Alvo</TableHead>
              <TableHead className="text-zinc-400">Resumo</TableHead>
              <TableHead className="text-zinc-400">Data</TableHead>
              <TableHead className="text-zinc-400">Request ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.length === 0 ? (
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableCell colSpan={8} className="py-10 text-center text-zinc-400">
                  Nenhum evento encontrado para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              result.items.map((item) => (
                <TableRow key={item.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="font-mono text-xs text-zinc-200">{item.action}</TableCell>
                  <TableCell>
                    <Badge variant={SEVERITY_BADGE_VARIANT[item.severity] ?? "outline"}>{item.severity}</Badge>
                  </TableCell>
                  <TableCell className="text-zinc-300">{item.source}</TableCell>
                  <TableCell className="text-zinc-300">{item.actorEmailMasked ?? "—"}</TableCell>
                  <TableCell className="text-zinc-300">
                    {item.targetType ? `${item.targetType}${item.targetId ? ` (${item.targetId.slice(0, 8)}…)` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-zinc-400" title={item.summary || undefined}>
                    {item.summary || "—"}
                  </TableCell>
                  <TableCell className="text-zinc-300">{formatDate(item.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500">{item.requestId ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>
            Página {page} de {totalPages} ({result.totalCount} no total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              className={cn("border-white/15 text-zinc-200 hover:bg-white/10")}
              render={<Link href={pageHref({ page: Math.max(1, page - 1) })} />}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              className="border-white/15 text-zinc-200 hover:bg-white/10"
              render={<Link href={pageHref({ page: Math.min(totalPages, page + 1) })} />}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
