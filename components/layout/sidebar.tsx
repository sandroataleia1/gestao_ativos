"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    // Azul (mesmo tom da tela de login) só no tema claro — no escuro, a
    // sidebar volta a usar as cores normais do tema (bg-card/border), como
    // o resto da área autenticada.
    <aside className="hidden w-60 shrink-0 flex-col border-r border-blue-900 bg-blue-950 md:flex dark:border-border dark:bg-card">
      <div className="flex h-14 items-center border-b border-blue-900 px-4 dark:border-border">
        <span className="font-heading text-sm font-semibold text-zinc-50 dark:text-foreground">
          Gestão de Ativos
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="grid gap-1">
            <span className="px-2.5 text-xs font-semibold tracking-wide text-blue-100/50 uppercase dark:text-muted-foreground/70">
              {group.label}
            </span>
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-blue-100/70 transition-colors hover:bg-white/10 hover:text-white dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground",
                    isActive &&
                      "bg-white/10 text-white hover:bg-white/15 hover:text-white dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/15 dark:hover:text-primary",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
