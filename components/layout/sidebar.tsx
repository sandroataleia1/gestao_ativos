"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon, PackageCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PermissionKey } from "@/lib/permissions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { filterNavGroupsByPermission, getActiveNavHref, isSubmenuActive, type NavLeaf } from "./nav-items";

// Sprint Demo Comercial SST 1.2, Parte 4 — a marca principal deixa de ser
// "Gestão de Ativos" (isso agora é só um módulo/capacidade do produto,
// listado dentro de "Operação"). Estrutura "Nome da plataforma / Portal
// Empresa" espelha deliberadamente o cabeçalho do Portal Consultoria
// (app/sst/(portal)/layout.tsx) — mesma lógica de identidade, ícone e cor
// diferentes para distinguir os dois portais à primeira vista.
function BrandHeader() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-4 py-3.5">
      <span className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-white dark:bg-primary/10 dark:text-primary">
        <PackageCheckIcon className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block font-heading text-sm font-semibold text-zinc-50 dark:text-foreground">
          Patrium
        </span>
        <span className="block text-[11px] font-medium tracking-wide text-blue-100/60 uppercase dark:text-muted-foreground">
          Portal Empresa
        </span>
      </span>
    </Link>
  );
}

function NavLink({ item, isActive }: { item: NavLeaf; isActive: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.description}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-blue-100/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/50 focus-visible:outline-none dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground dark:focus-visible:ring-ring/50",
        isActive &&
          "bg-white/10 text-white hover:bg-white/15 hover:text-white dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/15 dark:hover:text-primary",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

export function Sidebar({ navPermissions }: { navPermissions: Partial<Record<PermissionKey, boolean>> }) {
  const pathname = usePathname();
  const activeHref = getActiveNavHref(pathname);
  // Filtragem roda no client (não no Server Component pai) porque o
  // resultado carrega referências de componente de ícone (LucideIcon) —
  // React não consegue serializar funções ao passar de Server Component
  // para Client Component como prop. `navPermissions` (só booleans) é o
  // que de fato atravessa essa fronteira; NAV_GROUPS com os ícones já
  // vive inteiro no bundle client (ver ./nav-items).
  const navGroups = filterNavGroupsByPermission(navPermissions);

  return (
    // Azul (mesmo tom da tela de login) só no tema claro — no escuro, a
    // sidebar volta a usar as cores normais do tema (bg-card/border), como
    // o resto da área autenticada.
    <aside className="hidden w-60 shrink-0 flex-col border-r border-blue-900 bg-blue-950 md:flex dark:border-border dark:bg-card">
      <div className="border-b border-blue-900 dark:border-border">
        <BrandHeader />
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
        {navGroups.map((group) => (
          <div key={group.label} className="grid gap-1">
            <span className="px-2.5 text-xs font-semibold tracking-wide text-blue-100/50 uppercase dark:text-muted-foreground/70">
              {group.label}
            </span>
            {group.items.map((entry) => {
              if (entry.kind === "link") {
                return <NavLink key={entry.href} item={entry} isActive={entry.href === activeHref} />;
              }

              const submenuActive = isSubmenuActive(pathname, entry);
              const SubmenuIcon = entry.icon;
              return (
                <Collapsible key={entry.label} defaultOpen={submenuActive}>
                  <CollapsibleTrigger
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-blue-100/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/50 focus-visible:outline-none dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground dark:focus-visible:ring-ring/50",
                      submenuActive && "text-white dark:text-foreground",
                    )}
                  >
                    <SubmenuIcon className="size-4" />
                    <span className="flex-1 text-left">{entry.label}</span>
                    <ChevronDownIcon className="size-3.5 transition-transform group-data-panel-open:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-1 overflow-hidden pl-4 data-starting-style:h-0 data-ending-style:h-0">
                    {entry.items.map((item) => (
                      <NavLink key={item.href} item={item} isActive={item.href === activeHref} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
