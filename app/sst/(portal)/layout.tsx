import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/layout/user-menu";
import { SstNav } from "./sst-nav";

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Proprietário",
  TECHNICIAN: "Técnico",
  VIEWER: "Consulta",
};

// Layout do Portal Consultoria SST — totalmente separado do Portal Empresa
// (app/(app)/layout.tsx): sem Sidebar/Header daquele portal, sem nenhum
// item de menu de Ativos/Estoque/Entregas/Custódias/Configurações da
// empresa. requireSstAuthOrDeny() aqui protege todas as rotas abaixo.
//
// Identidade sempre visível no header (Sprint Demo Comercial SST 1.0, Parte
// 4): nome da consultoria, rótulo "Portal Consultoria" (distingue do Portal
// Empresa mesmo para quem tem acesso aos dois), nome do usuário, papel
// atual, ação de sair — esta última corrigida para voltar a /sst/login, não
// /login (Portal Empresa).
export default async function SstLayout({ children }: { children: React.ReactNode }) {
  const { user, sstProviderUser } = await requireSstAuthOrDeny();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-6 py-3">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <Link href="/sst/dashboard" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheckIcon className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block font-heading text-base font-semibold">{sstProviderUser.provider.name}</span>
              <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Portal Consultoria
              </span>
            </span>
          </Link>
          <SstNav />
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="hidden sm:inline-flex">
            {ROLE_LABELS[sstProviderUser.role] ?? sstProviderUser.role}
          </Badge>
          <UserMenu name={user.name} email={user.email} signOutRedirectTo="/sst/login" />
        </div>
      </header>
      <main className="flex-1 bg-muted/30 p-6">{children}</main>
    </div>
  );
}
