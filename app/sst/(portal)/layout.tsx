import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SstNav } from "./sst-nav";

// Mesmo contraste usado em NotificationBell/UserMenu abaixo — texto claro
// sobre o header azul no tema claro, volta ao padrão neutro no escuro.
const HEADER_ACTION_CLASSNAME = "text-blue-50 hover:bg-white/10 hover:text-white dark:text-foreground dark:hover:bg-muted";

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
      {/* Mesma cor da sidebar do Portal Empresa no tema claro
          (components/layout/sidebar.tsx) — só no claro: no escuro, volta ao
          bg-card/border-border padrão do resto do portal. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-900 bg-blue-950 px-6 py-3 dark:border-border dark:bg-card">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <Link href="/sst/dashboard" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-white dark:bg-primary/10 dark:text-primary">
              <ShieldCheckIcon className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block font-heading text-base font-semibold text-zinc-50 dark:text-foreground">
                {sstProviderUser.provider.name}
              </span>
              <span className="block text-[11px] font-medium tracking-wide text-blue-100/60 uppercase dark:text-muted-foreground">
                Portal Consultoria
              </span>
            </span>
          </Link>
          <SstNav />
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="hidden border-white/25 text-blue-50 sm:inline-flex dark:border-border dark:text-foreground"
          >
            {ROLE_LABELS[sstProviderUser.role] ?? sstProviderUser.role}
          </Badge>
          <NotificationBell
            apiBase="/api/sst/notifications"
            historyHref="/sst/notifications"
            triggerClassName={HEADER_ACTION_CLASSNAME}
          />
          <ThemeToggle triggerClassName={HEADER_ACTION_CLASSNAME} />
          <UserMenu
            name={user.name}
            email={user.email}
            signOutRedirectTo="/sst/login"
            triggerClassName={HEADER_ACTION_CLASSNAME}
            emailClassName="text-blue-100/60 dark:text-muted-foreground"
          />
        </div>
      </header>
      <main className="flex-1 bg-muted/30 p-6">{children}</main>
    </div>
  );
}
