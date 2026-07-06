import type { Metadata } from "next";
import Link from "next/link";
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
import { getDashboardSummary, getRecentMovements } from "@/lib/dashboard";
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

  const [summary, recentMovements] = await Promise.all([
    getDashboardSummary(user.companyId),
    getRecentMovements(user.companyId, 10),
  ]);

  const summaryCards = [
    { label: "Em posse", value: summary.inPossessionQuantity, icon: PackageIcon, href: "/custodies" },
    { label: "Em estoque", value: summary.inStockQuantity, icon: BoxesIcon, href: "/stock" },
    {
      label: "Alertas críticos",
      value: canViewAlerts ? summary.criticalAlerts.length : "—",
      icon: AlertTriangleIcon,
      href: "/alerts",
    },
    {
      label: "CAs vencendo em 30 dias",
      value: canViewAlerts ? summary.caExpiringSoonCount : "—",
      icon: FileWarningIcon,
      href: "/reports",
    },
  ];

  const quickActions = [
    canManageAsset ? { label: "Novo ativo", href: "/assets/new", icon: PackagePlusIcon } : null,
    canManageCustody ? { label: "Nova entrega", href: "/custodies/new", icon: TruckIcon } : null,
    canManageEmployee
      ? { label: "Novo colaborador", href: "/employees/new", icon: UserPlusIcon }
      : null,
    canManageStock ? { label: "Entrada de estoque", href: "/stock/new", icon: BoxesIcon } : null,
  ].filter((action): action is { label: string; href: string; icon: typeof PackagePlusIcon } => action !== null);

  const operationalIndicators = canViewAlerts
    ? [
        { label: "Custódias atrasadas", value: summary.overdueCustodyCount, href: "/custodies" },
        { label: "Estoque crítico", value: summary.lowStockCount, href: "/stock" },
        { label: "CAs vencidos", value: summary.caExpiredCount, href: "/reports" },
        { label: "CAs vencendo", value: summary.caExpiringSoonCount, href: "/reports" },
      ]
    : [];

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
        {summaryCards.map(({ label, value, icon: Icon, href }) => (
          <Link key={label} href={href} className="block">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/40">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {label}
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
        ))}
      </div>

      {operationalIndicators.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {operationalIndicators.map(({ label, value, href }) => (
            <Link key={label} href={href} className="block">
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-lg font-semibold">{value}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {canViewAlerts ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <TruckIcon className="size-4 text-destructive" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Entregas atrasadas
              </CardTitle>
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
            {summary.overdueCustodyAlerts.length ? (
              <ul className="grid gap-2 text-sm">
                {summary.overdueCustodyAlerts.slice(0, 5).map((alert) => (
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
      ) : null}

      {canViewAlerts ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangleIcon className="size-4 text-destructive" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Alertas críticos
              </CardTitle>
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
            {summary.criticalAlerts.length ? (
              <ul className="grid gap-2 text-sm">
                {summary.criticalAlerts.slice(0, 5).map((alert) => (
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
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Últimas movimentações
            </CardTitle>
          </div>
          <Button size="sm" variant="outline" render={<Link href="/stock" />}>
            Ver histórico completo
          </Button>
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
            <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
