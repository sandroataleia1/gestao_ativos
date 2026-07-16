import Link from "next/link";
import { ShieldIcon } from "lucide-react";

import { requirePlatformRoleOrDeny } from "@/lib/platform-auth";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { PlatformAdminNav } from "./platform-admin-nav";

// Sprint SST 1.4D, §6 — layout do Portal Super Admin Lite, TOTALMENTE
// separado do Portal Empresa (app/(app)/layout.tsx) e do Portal Consultoria
// (app/sst/(portal)/layout.tsx): sem Sidebar/Header desses portais, sem
// nenhum item de menu de Ativos/Estoque/Colaboradores/Treinamentos/
// Consultorias. requirePlatformRoleOrDeny("SUPER_ADMIN") aqui protege TODAS
// as rotas abaixo — esconder o menu nunca é o guard, é só a UI.
//
// Visual deliberadamente distinto (fundo escuro/zinc, nunca a mesma paleta
// azul do Portal Consultoria nem o branco do Portal Empresa) — ninguém deve
// confundir esta área com "dentro de uma Company".
export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformRoleOrDeny("SUPER_ADMIN");

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black px-6 py-3">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <Link href="/platform-admin" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-white">
              <ShieldIcon className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block font-heading text-base font-semibold text-zinc-50">Administração da plataforma</span>
              <span className="block text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                Ambiente administrativo da plataforma
              </span>
            </span>
          </Link>
          <PlatformAdminNav />
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell
            apiBase="/api/platform-admin/notifications"
            historyHref="/platform-admin/notifications"
            triggerClassName="text-zinc-200 hover:bg-white/10 hover:text-white"
          />
          <UserMenu
            name={user.name}
            email={user.email}
            signOutRedirectTo="/login"
            triggerClassName="text-zinc-200 hover:bg-white/10 hover:text-white"
            emailClassName="text-zinc-500"
          />
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
