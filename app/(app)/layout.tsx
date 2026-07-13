import { prisma } from "@/lib/prisma";
import { getCurrentCompany, hasPermission, requireCompanyOrDeny } from "@/lib/auth-server";
import { listAvailableCompanyContexts } from "@/lib/company-selection";
import { PERMISSIONS } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

// Layout raiz de todo o Portal Empresa (app/(app)/**) — usa
// `requireCompanyOrDeny()` (não só autenticação) para que a validação de
// `CompanyMembership` ACTIVE aconteça em profundidade de defesa para
// qualquer página da árvore, mesmo que uma página individual esqueça de
// checar. Redireciona para /login (401), para /select-company (seleção
// necessária) ou renderiza app/forbidden.tsx (403) automaticamente — ver
// lib/auth-server.ts.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, companyId } = await requireCompanyOrDeny();

  const [company, activeEmployeeCount, switchableCompanies, navPermissions] = await Promise.all([
    getCurrentCompany(companyId),
    prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
    // Sprint 0.6, Parte E — o Header só renderiza o seletor quando há mais
    // de 1 item; com 0 ou 1 (a grande maioria dos usuários hoje) fica oculto.
    listAvailableCompanyContexts(user.id),
    // Sprint Demo Comercial SST 1.2 — a sidebar nunca deve linkar para uma
    // página que o usuário não pode abrir (ver components/layout/nav-items.ts,
    // filterNavGroupsByPermission). A checagem de verdade continua em cada
    // página via requirePermissionOrDeny(); isto só decide o que MOSTRAR.
    Promise.all([
      hasPermission(PERMISSIONS.ASSET_VIEW),
      hasPermission(PERMISSIONS.STOCK_VIEW),
      hasPermission(PERMISSIONS.CUSTODY_VIEW),
      hasPermission(PERMISSIONS.EMPLOYEE_VIEW),
      hasPermission(PERMISSIONS.TRAINING_VIEW),
      hasPermission(PERMISSIONS.ALERT_VIEW),
      hasPermission(PERMISSIONS.REPORT_VIEW),
      hasPermission(PERMISSIONS.IMPORT_VIEW),
    ]).then(
      ([assetView, stockView, custodyView, employeeView, trainingView, alertView, reportView, importView]) => ({
        [PERMISSIONS.ASSET_VIEW]: assetView,
        [PERMISSIONS.STOCK_VIEW]: stockView,
        [PERMISSIONS.CUSTODY_VIEW]: custodyView,
        [PERMISSIONS.EMPLOYEE_VIEW]: employeeView,
        [PERMISSIONS.TRAINING_VIEW]: trainingView,
        [PERMISSIONS.ALERT_VIEW]: alertView,
        [PERMISSIONS.REPORT_VIEW]: reportView,
        [PERMISSIONS.IMPORT_VIEW]: importView,
      }),
    ),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar navPermissions={navPermissions} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={user.name}
          userEmail={user.email}
          companyName={company?.tradeName || company?.name || "—"}
          companyLogoDataUrl={company?.logoDataUrl}
          activeEmployeeCount={activeEmployeeCount}
          currentCompanyId={companyId}
          switchableCompanies={switchableCompanies}
          navPermissions={navPermissions}
        />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
