import { prisma } from "@/lib/prisma";
import { getCurrentCompany, requireCompanyOrDeny } from "@/lib/auth-server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

// Layout raiz de todo o Portal Empresa (app/(app)/**) — usa
// `requireCompanyOrDeny()` (não só autenticação) para que a validação de
// `CompanyMembership` ACTIVE aconteça em profundidade de defesa para
// qualquer página da árvore, mesmo que uma página individual esqueça de
// checar. Redireciona para /login (401) ou renderiza app/forbidden.tsx (403)
// automaticamente — ver lib/auth-server.ts.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, companyId } = await requireCompanyOrDeny();

  const [company, activeEmployeeCount] = await Promise.all([
    getCurrentCompany(companyId),
    prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userName={user.name}
          userEmail={user.email}
          companyName={company?.tradeName || company?.name || "—"}
          companyLogoDataUrl={company?.logoDataUrl}
          activeEmployeeCount={activeEmployeeCount}
        />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
