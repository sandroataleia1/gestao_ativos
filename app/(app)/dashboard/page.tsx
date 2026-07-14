import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BoxesIcon,
  ChevronDownIcon,
  FileWarningIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PackageIcon,
  PackagePlusIcon,
  PlusIcon,
  TruckIcon,
  UserPlusIcon,
} from "lucide-react";

import { getCurrentCompany, hasPermission, requireCompanyOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import {
  buildDashboardQuickActions,
  getDashboardFastSummary,
  getRecentMovements,
  type QuickActionKey,
} from "@/lib/dashboard";
import { getCachedDashboardAlertsSummary } from "@/lib/cache";
import { countPendingProviderRequests } from "@/lib/sst-providers";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HintIcon } from "./hint-icon";
import { PriorityAlerts } from "./priority-alerts";

const CA_HINT = "CA = Certificado de Aprovação, exigido para alguns equipamentos de proteção (EPIs).";

export const metadata: Metadata = {
  title: "Visão geral — Patrium",
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type IconType = typeof PackageIcon;

function SummaryCardShell({
  label,
  value,
  icon: Icon,
  href,
  hint,
  emphasis,
}: {
  label: string;
  value: number | string;
  icon: IconType;
  href: string;
  hint?: string;
  /** Cards de pendência usam vermelho só quando há algo crítico de fato —
   * nunca decorativo (Parte 9: "a cor vermelha deve continuar reservada a
   * situações críticas"). */
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card
        className={
          emphasis
            ? "h-full cursor-pointer border-destructive/30 transition-colors hover:border-destructive/60 hover:bg-destructive/5"
            : "h-full cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40"
        }
      >
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {label}
            {hint ? <HintIcon hint={hint} /> : null}
          </CardTitle>
          <span
            className={
              emphasis
                ? "flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                : "flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
            }
          >
            <Icon className="size-4" />
          </span>
        </CardHeader>
        <CardContent>
          <p className={emphasis ? "text-2xl font-semibold text-destructive" : "text-2xl font-semibold"}>{value}</p>
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

/** Cards que dependem dos 3 tipos de alerta (CA, custódia atrasada, estoque
 * baixo) — a parte mais cara do dashboard. Fica atrás de `<Suspense>` em
 * page.tsx para não atrasar a renderização dos cards rápidos (posse/estoque)
 * acima. `getCachedDashboardAlertsSummary` já é cacheado por empresa. */
async function AlertsDependentSection({ companyId }: { companyId: string }) {
  const alerts = await getCachedDashboardAlertsSummary(companyId);

  return (
    <>
      <SummaryCardShell
        label="Pendências críticas"
        value={alerts.criticalAlerts.length}
        icon={AlertTriangleIcon}
        href="/alerts"
        emphasis={alerts.criticalAlerts.length > 0}
      />
      <SummaryCardShell
        label="CAs a vencer"
        value={alerts.caExpiringSoonCount}
        icon={FileWarningIcon}
        href="/reports"
        hint={CA_HINT}
      />

      <Card className="col-span-full">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-primary" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Pendências prioritárias</CardTitle>
          </div>
          <Link
            href="/alerts"
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
          >
            Ver todas
            <ArrowRightIcon className="size-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <PriorityAlerts alerts={alerts.priorityAlerts} />
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
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-primary" />
          <CardTitle className="text-sm font-medium text-muted-foreground">Últimas movimentações</CardTitle>
        </div>
        <Link
          href="/stock"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
        >
          Ver histórico completo
          <ArrowRightIcon className="size-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {recentMovements.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="hidden sm:table-cell">Colaborador</TableHead>
                  <TableHead className="hidden md:table-cell">Data/hora</TableHead>
                  <TableHead className="hidden lg:table-cell">Usuário responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      <Badge variant="outline">{movement.type}</Badge>
                    </TableCell>
                    <TableCell>{movement.assetName}</TableCell>
                    <TableCell className="hidden sm:table-cell">{movement.employeeName ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDateTime(movement.executedAt)}</TableCell>
                    <TableCell className="hidden lg:table-cell">{movement.userName ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
  const { companyId } = await requireCompanyOrDeny();
  const company = await getCurrentCompany(companyId);
  const [canViewAlerts, canManageAsset, canManageCustody, canManageStock, canManageEmployee, canManageSstProvider] =
    await Promise.all([
      hasPermission(PERMISSIONS.ALERT_VIEW),
      hasPermission(PERMISSIONS.ASSET_MANAGE),
      hasPermission(PERMISSIONS.CUSTODY_MANAGE),
      hasPermission(PERMISSIONS.STOCK_MANAGE),
      hasPermission(PERMISSIONS.EMPLOYEE_MANAGE),
      hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE),
    ]);
  // Sprint Comercial SST 1.4, §14 — aviso discreto (não é um sistema de
  // notificação novo, só uma contagem) quando existe solicitação de acesso
  // SST aguardando análise; só quem pode agir sobre ela vê o aviso.
  const pendingProviderRequests = canManageSstProvider ? await countPendingProviderRequests(companyId) : 0;

  // Só os 2 cards rápidos (aggregate/count) bloqueiam a renderização inicial
  // — alertas e movimentações recentes streamam depois, em paralelo, cada
  // um no seu próprio <Suspense> (ver docs/performance.md).
  const fastSummary = await getDashboardFastSummary(companyId);

  // Sprint Demo Comercial SST 1.2, Parte 8 — hierarquia visual entre as
  // ações rápidas: a primeira disponível (nesta ordem de prioridade) vira o
  // botão primário, a segunda vira secundário, e o resto (se houver) some
  // dentro de "Mais ações" — nunca todas com o mesmo peso competindo com o
  // título da página. Ordenação/filtro por permissão vêm de
  // lib/dashboard.ts (buildDashboardQuickActions), testado isoladamente.
  const QUICK_ACTION_ICONS: Record<QuickActionKey, typeof TruckIcon> = {
    custody: TruckIcon,
    stock: BoxesIcon,
    employee: UserPlusIcon,
    asset: PackagePlusIcon,
  };
  const actionsInPriorityOrder = buildDashboardQuickActions({
    canManageCustody,
    canManageStock,
    canManageEmployee,
    canManageAsset,
  }).map((action) => ({ ...action, icon: QUICK_ACTION_ICONS[action.key] }));

  const [primaryAction, secondaryAction, ...overflowActions] = actionsInPriorityOrder;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe ativos, entregas, estoque, treinamentos e alertas
            {company?.name ? ` da ${company.name}` : ""}.
          </p>
        </div>

        {primaryAction ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link href={primaryAction.href} />}>
              <PlusIcon className="size-4" />
              {primaryAction.label}
            </Button>
            {secondaryAction ? (
              <Button variant="outline" render={<Link href={secondaryAction.href} />}>
                <PlusIcon className="size-4" />
                {secondaryAction.label}
              </Button>
            ) : null}
            {overflowActions.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" aria-label="Mais ações">
                      <span className="hidden sm:inline">Mais ações</span>
                      <MoreHorizontalIcon className="size-4 sm:hidden" />
                      <ChevronDownIcon className="hidden size-3.5 sm:inline" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {overflowActions.map(({ label, href, icon: Icon }) => (
                    <DropdownMenuItem key={href} render={<Link href={href} />}>
                      <Icon className="size-4" />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>

      {pendingProviderRequests > 0 ? (
        <Alert>
          <AlertTitle>Nova solicitação de acesso SST</AlertTitle>
          <AlertDescription>
            <p>
              {pendingProviderRequests === 1
                ? "Uma consultoria solicitou autorização para operar informações de SST da sua empresa."
                : `${pendingProviderRequests} consultorias solicitaram autorização para operar informações de SST da sua empresa.`}
            </p>
            <Button size="sm" className="mt-2" render={<Link href="/configuracoes/sst-providers" />}>
              Analisar solicitação
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

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
                <SummaryCardSkeleton label="Pendências críticas" icon={AlertTriangleIcon} />
                <SummaryCardSkeleton label="CAs a vencer" icon={FileWarningIcon} />
                <div className="col-span-full">
                  <CardSkeleton title="Pendências prioritárias" />
                </div>
              </>
            }
          >
            <AlertsDependentSection companyId={companyId} />
          </Suspense>
        ) : null}
      </div>

      <Suspense fallback={<CardSkeleton title="Últimas movimentações" />}>
        <RecentMovementsSection companyId={companyId} />
      </Suspense>
    </div>
  );
}
