import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";

import { getPlatformAdminDashboardSummary } from "@/lib/platform-admin-listing";
import { listCompanyClaimsForAdmin } from "@/lib/platform-admin-listing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Administração da plataforma — Gestão de Ativos",
};

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Sprint SST 1.4D, §7 — dashboard mínimo: só indicadores de governança
// (fila de reivindicações), nunca uma visão operacional dos clientes.
// Nenhum número de colaboradores/treinamentos/ativos/estoque/documentos é
// sequer consultado aqui.
export default async function PlatformAdminDashboardPage() {
  const [summary, queue] = await Promise.all([
    getPlatformAdminDashboardSummary(),
    listCompanyClaimsForAdmin({ status: "ALL", page: 1, pageSize: 10 }),
  ]);

  const queueItems = queue.items.filter((item) => item.status === "PENDING" || item.status === "UNDER_REVIEW" || item.companyControlStatus === "DISPUTED");

  const cards = [
    { label: "Pendentes", value: summary.pendingCount, icon: ClockIcon },
    { label: "Em análise", value: summary.underReviewCount, icon: ClockIcon },
    { label: "Empresas em disputa", value: summary.disputedCompanyCount, icon: AlertTriangleIcon },
    { label: "Aprovadas (7 dias)", value: summary.approvedRecentCount, icon: CheckCircle2Icon },
    { label: "Não aprovadas (7 dias)", value: summary.rejectedRecentCount, icon: XCircleIcon },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className="text-sm text-zinc-400">Fila de governança de reivindicações empresariais.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.label} className="border-white/10 bg-white/5">
            <CardContent className="grid gap-2 pt-6">
              <card.icon className="size-5 text-zinc-400" />
              <span className="text-2xl font-semibold text-zinc-50">{card.value}</span>
              <span className="text-sm text-zinc-400">{card.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-zinc-50">Reivindicações que exigem análise</CardTitle>
        </CardHeader>
        <CardContent>
          {queueItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">Nenhuma reivindicação exige análise no momento.</p>
          ) : (
            <ul className="grid gap-2">
              {queueItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/platform-admin/company-claims/${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 p-3 text-sm hover:bg-white/5"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-50">{item.companyName}</span>
                      {item.companyControlStatus === "DISPUTED" ? <Badge variant="destructive">Disputa</Badge> : null}
                      <Badge variant="outline" className="border-white/20 text-zinc-300">
                        {item.status}
                      </Badge>
                    </span>
                    <span className="text-zinc-400">Solicitado em {formatDate(item.requestedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
