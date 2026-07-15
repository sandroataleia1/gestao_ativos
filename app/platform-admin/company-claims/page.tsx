import type { Metadata } from "next";
import Link from "next/link";

import { listCompanyClaimsForAdmin, type ClaimListFilter } from "@/lib/platform-admin-listing";
import { parsePageParams, parseSearchParam, type SearchParamsInput } from "@/lib/pagination";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Reivindicações — Administração da plataforma",
};

const STATUS_FILTERS: { value: ClaimListFilter; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDING", label: "Pendente" },
  { value: "UNDER_REVIEW", label: "Em análise" },
  { value: "APPROVED", label: "Aprovada" },
  { value: "REJECTED", label: "Não aprovada" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "EXPIRED", label: "Expirada" },
];

const STATUS_BADGE_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  PENDING: "outline",
  UNDER_REVIEW: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  CANCELLED: "outline",
  EXPIRED: "outline",
};

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Sprint SST 1.4D, §8 — filtros, busca (nome/CNPJ/e-mail — nunca pública,
// esta página inteira já está atrás de requirePlatformRoleOrDeny no
// layout), paginação server-side. Nunca exibe colaboradores/treinamentos/
// ativos/documentos — só os 9 campos explicitamente pedidos pelo spec.
export default async function PlatformAdminCompanyClaimsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const resolvedSearchParams = await searchParams;
  const { page, pageSize } = parsePageParams(resolvedSearchParams, { defaultPageSize: 20 });
  const search = parseSearchParam(resolvedSearchParams);
  const rawStatus = resolvedSearchParams.status;
  const status = (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus) ?? "ALL";
  const activeStatus: ClaimListFilter = STATUS_FILTERS.some((f) => f.value === status) ? (status as ClaimListFilter) : "ALL";

  const result = await listCompanyClaimsForAdmin({ status: activeStatus, search: search || undefined, page, pageSize });
  const totalPages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));

  function pageHref(overrides: Record<string, string | number>) {
    const params = new URLSearchParams();
    params.set("status", activeStatus);
    if (search) params.set("q", search);
    params.set("page", String(page));
    for (const [key, value] of Object.entries(overrides)) params.set(key, String(value));
    return `/platform-admin/company-claims?${params.toString()}`;
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Reivindicações</h1>
        <p className="text-sm text-zinc-400">Fila de análise e decisão de CompanyClaimRequest.</p>
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/platform-admin/company-claims" method="get">
        <input type="hidden" name="status" value={activeStatus} />
        <Input
          name="q"
          defaultValue={search}
          placeholder="Buscar por empresa, CNPJ ou e-mail do solicitante"
          className="max-w-sm border-white/15 bg-white/5 text-zinc-50 placeholder:text-zinc-500"
        />
        <Button type="submit" variant="outline" className="border-white/15 text-zinc-200 hover:bg-white/10">
          Buscar
        </Button>
      </form>

      <nav className="flex flex-wrap gap-1 text-sm">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={pageHref({ status: filter.value, page: 1 })}
            className={cn(
              "rounded-md px-3 py-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white",
              activeStatus === filter.value && "bg-white/10 text-white",
            )}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-zinc-400">Empresa</TableHead>
              <TableHead className="text-zinc-400">CNPJ</TableHead>
              <TableHead className="text-zinc-400">Solicitante</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-zinc-400">Solicitado em</TableHead>
              <TableHead className="text-zinc-400">Solicitações ativas</TableHead>
              <TableHead className="text-zinc-400">Origem</TableHead>
              <TableHead className="text-zinc-400">Consultoria</TableHead>
              <TableHead className="text-right text-zinc-400">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.length === 0 ? (
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableCell colSpan={9} className="py-10 text-center text-zinc-400">
                  Nenhuma reivindicação encontrada para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              result.items.map((item) => (
                <TableRow key={item.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="font-medium text-zinc-50">
                    {item.companyName}
                    {item.companyControlStatus === "DISPUTED" ? (
                      <Badge variant="destructive" className="ml-2">
                        Disputa
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-zinc-300">{item.companyCnpjMasked ?? "—"}</TableCell>
                  <TableCell className="text-zinc-300">{item.requesterEmailMasked}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-zinc-300">{formatDate(item.requestedAt)}</TableCell>
                  <TableCell className="text-zinc-300">{item.concurrentActiveClaimCount}</TableCell>
                  <TableCell className="text-zinc-300">{item.companyOrigin}</TableCell>
                  <TableCell className="text-zinc-300">
                    {item.hasProvisionalProvider ? "Possui consultoria provisória" : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="border-white/15 text-zinc-200 hover:bg-white/10" render={<Link href={`/platform-admin/company-claims/${item.id}`} />}>
                      Analisar
                    </Button>
                  </TableCell>
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
              className="border-white/15 text-zinc-200 hover:bg-white/10"
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
