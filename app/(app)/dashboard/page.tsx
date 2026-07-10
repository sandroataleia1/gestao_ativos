import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BoxesIcon,
  CheckCircle2Icon,
  FileWarningIcon,
  HistoryIcon,
  PackageIcon,
  PackagePlusIcon,
  PlusIcon,
  TruckIcon,
  UserPlusIcon,
} from "lucide-react";

import type { AlertSeverity } from "@/lib/alerts";
import { getCurrentCompany, hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getDashboardFastSummary, getRecentMovements } from "@/lib/dashboard";
import { getCachedDashboardAlertsSummary } from "@/lib/cache";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HintIcon } from "./hint-icon";

const CA_HINT = "CA = Certificado de Aprovação, exigido para alguns equipamentos de proteção (EPIs).";

export const metadata: Metadata = {
  title: "Dashboard — Gestão de Ativos",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const OVERDUE_SEVERITY_BADGE: Record<AlertSeverity, { label: string; variant: "destructive" | "outline" }> = {
  CRITICAL: { label: "Crítico", variant: "destructive" },
  WARNING: { label: "Atenção", variant: "outline" },
  INFO: { label: "Info", variant: "outline" },
};

type IconType = typeof PackageIcon;

function SummaryCardShell({
  label,
  value,
  icon: Icon,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  icon: IconType;
  href: string;
  hint?: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {label}
            {hint ? <HintIcon hint={hint} /> : null}
          </CardTitle>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function SummaryCardSkeleton({ label, icon: Icon }: { label: string; icon: IconType }) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <div className="h-8 w-12 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function IndicatorSkeleton() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-5 w-8 animate-pulse rounded bg-muted" />
    </div>
  );
}

function CardSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Cards/indicadores/listas que dependem dos 3 tipos de alerta (CA, custódia
 * atrasada, estoque baixo) — a parte mais cara do dashboard. Fica atrás de
 * `<Suspense>` em page.tsx para não atrasar a renderização dos cards
 * rápidos (posse/estoque) acima. `getDashboardAlertsSummary` é `cache()`d,
 * então mesmo aparecendo aqui e nos indicadores operacionais/cards abaixo,
 * as consultas de alerta rodam uma única vez por requisição. */
async function AlertsDependentSection({ companyId }: { companyId: string }) {
  const alerts = await getCachedDashboardAlertsSummary(companyId);

  const alertSummaryCards = [
    { label: "Alertas críticos", value: alerts.criticalAlerts.length, icon: AlertTriangleIcon, href: "/alerts" },
    {
      label: "CAs vencendo em 30 dias",
      value: alerts.caExpiringSoonCount,
      icon: FileWarningIcon,
      href: "/reports",
      hint: CA_HINT,
    },
  ];

  const operationalIndicators = [
    { label: "Custódias atrasadas", value: alerts.overdueCustodyCount, href: "/custodies" },
    { label: "Estoque crítico", value: alerts.lowStockCount, href: "/stock" },
    { label: "CAs vencidos", value: alerts.caExpiredCount, href: "/reports", hint: CA_HINT },
    { label: "CAs vencendo", value: alerts.caExpiringSoonCount, href: "/reports", hint: CA_HINT },
  ];

  return (
    <>
      {alertSummaryCards.map(({ label, value, icon, href, hint }) => (
        <SummaryCardShell key={label} label={label} value={value} icon={icon} href={href} hint={hint} />
      ))}

      <div className="col-span-full grid grid-cols-2 gap-3 lg:grid-cols-4">
        {operationalIndicators.map(({ label, value, href, hint }) => (
          <Link key={label} href={href} className="block">
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {label}
                {hint ? <HintIcon hint={hint} /> : null}
              </span>
              <span className="text-lg font-semibold">{value}</span>
            </div>
          </Link>
        ))}
      </div>

      <Card className="col-span-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <TruckIcon className="size-4 text-destructive" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Entregas atrasadas</CardTitle>
          </div>
          <Link
            href="/custodies"
            className="flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
          >
            Ver todas
            <ArrowRightIcon className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {alerts.overdueCustodyAlerts.length ? (
            <ul className="grid gap-2 text-sm">
              {alerts.overdueCustodyAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-4">
                  <span className="truncate">{alert.title}</span>
                  <Badge variant={OVERDUE_SEVERITY_BADGE[alert.severity].variant}>
                    {OVERDUE_SEVERITY_BADGE[alert.severity].label}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
              <span>Nenhuma entrega atrasada.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="col-span-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-destructive" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Alertas críticos</CardTitle>
          </div>
          <Link
            href="/alerts"
            className="flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
          >
            Ver todos
            <ArrowRightIcon className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {alerts.criticalAlerts.length ? (
            <ul className="grid gap-2 text-sm">
              {alerts.criticalAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-4">
                  <span className="truncate">{alert.title}</span>
                  <Badge variant="destructive">Crítico</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
              <span>Tudo certo. Nenhum alerta crítico encontrado.</span>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Última seção a resolver — não bloqueia o resto do dashboard atrás dela. */
async function RecentMovementsSection({ companyId }: { companyId: string }) {
  const recentMovements = await getRecentMovements(companyId, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" />
          <CardTitle className="text-sm font-medium text-muted-foreground">Últimas movimentações</CardTitle>
        </div>
        <Link
          href="/stock"
          className="flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
        >
          Ver histórico completo
          <ArrowRightIcon className="size-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {recentMovements.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead>Colaborador</TableHead>
                <TableHead>Data/hora</TableHead>
                <TableHead>Usuário responsável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentMovements.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell>
                    <Badge variant="outline">{movement.type}</Badge>
                  </TableCell>
                  <TableCell>{movement.assetName}</TableCell>
                  <TableCell>{movement.employeeName ?? "—"}</TableCell>
                  <TableCell>{formatDateTime(movement.executedAt)}</TableCell>
                  <TableCell>{movement.userName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HistoryIcon className="size-4" />
            <span>Nenhuma movimentação registrada ainda.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireAuthOrDeny();
  const company = await getCurrentCompany();
  const [canViewAlerts, canManageAsset, canManageCustody, canManageStock, canManageEmployee] =
    await Promise.all([
      hasPermission(PERMISSIONS.ALERT_VIEW),
      hasPermission(PERMISSIONS.ASSET_MANAGE),
      hasPermission(PERMISSIONS.CUSTODY_MANAGE),
      hasPermission(PERMISSIONS.STOCK_MANAGE),
      hasPermission(PERMISSIONS.EMPLOYEE_MANAGE),
    ]);

  // Só os 2 cards rápidos (aggregate/count) bloqueiam a renderização inicial
  // — alertas e movimentações recentes streamam depois, em paralelo, cada
  // um no seu próprio <Suspense> (ver docs/performance.md).
  const fastSummary = await getDashboardFastSummary(user.companyId);

  const quickActions = [
    canManageAsset ? { label: "Novo ativo", href: "/assets/new", icon: PackagePlusIcon } : null,
    canManageCustody ? { label: "Nova entrega", href: "/custodies/new", icon: TruckIcon } : null,
    canManageEmployee
      ? { label: "Novo colaborador", href: "/employees/new", icon: UserPlusIcon }
      : null,
    canManageStock ? { label: "Entrada de estoque", href: "/stock/new", icon: BoxesIcon } : null,
  ].filter((action): action is { label: string; href: string; icon: typeof PackagePlusIcon } => action !== null);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Olá, {user.name}</h1>
          <p className="text-sm text-muted-foreground">
            {user.email} · {company?.name ?? "Empresa não encontrada"}
          </p>
        </div>

        {quickActions.length ? (
          <div className="flex flex-wrap gap-2">
            {quickActions.map(({ label, href, icon: Icon }) => (
              <Button key={href} variant="outline" render={<Link href={href} />}>
                <PlusIcon className="size-4" />
                {label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCardShell
          label="Em posse"
          value={fastSummary.inPossessionQuantity}
          icon={PackageIcon}
          href="/custodies"
        />
        <SummaryCardShell
          label="Em estoque"
          value={fastSummary.inStockQuantity}
          icon={BoxesIcon}
          href="/stock"
        />

        {canViewAlerts ? (
          <Suspense
            fallback={
              <>
                <SummaryCardSkeleton label="Alertas críticos" icon={AlertTriangleIcon} />
                <SummaryCardSkeleton label="CAs vencendo em 30 dias" icon={FileWarningIcon} />
                <div className="col-span-full grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <IndicatorSkeleton />
                  <IndicatorSkeleton />
                  <IndicatorSkeleton />
                  <IndicatorSkeleton />
                </div>
                <div className="col-span-full">
                  <CardSkeleton title="Entregas atrasadas" />
                </div>
                <div className="col-span-full">
                  <CardSkeleton title="Alertas críticos" />
                </div>
              </>
            }
          >
            <AlertsDependentSection companyId={user.companyId} />
          </Suspense>
        ) : null}
      </div>

      <Suspense fallback={<CardSkeleton title="Últimas movimentações" />}>
        <RecentMovementsSection companyId={user.companyId} />
      </Suspense>
    </div>
  );
}
