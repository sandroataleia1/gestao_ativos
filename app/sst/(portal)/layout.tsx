import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { UserMenu } from "@/components/layout/user-menu";

// Layout do Portal Consultoria SST — totalmente separado do Portal Empresa
// (app/(app)/layout.tsx): sem Sidebar/Header daquele portal, sem nenhum
// item de menu de Ativos/Estoque/Entregas/Custódias/Configurações da
// empresa. requireSstAuthOrDeny() aqui protege todas as rotas abaixo.
export default async function SstLayout({ children }: { children: React.ReactNode }) {
  const { user, sstProviderUser } = await requireSstAuthOrDeny();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/sst/dashboard" className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheckIcon className="size-4" />
            </span>
            {sstProviderUser.provider.name}
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
            <Link href="/sst/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/sst/companies" className="hover:text-foreground">
              Empresas
            </Link>
          </nav>
        </div>
        <UserMenu name={user.name} email={user.email} />
      </header>
      <main className="flex-1 bg-muted/30 p-6">{children}</main>
    </div>
  );
}
