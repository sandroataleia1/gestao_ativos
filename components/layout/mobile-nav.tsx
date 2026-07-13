"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon, MenuIcon, PackageCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PermissionKey } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { filterNavGroupsByPermission, getActiveNavHref, isSubmenuActive, type NavLeaf } from "./nav-items";

function NavLink({ item, isActive, onNavigate }: { item: NavLeaf; isActive: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.description}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        isActive && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

export function MobileNav({ navPermissions }: { navPermissions: Partial<Record<PermissionKey, boolean>> }) {
  const pathname = usePathname();
  const activeHref = getActiveNavHref(pathname);
  const [open, setOpen] = useState(false);
  // Mesmo motivo do Sidebar (components/layout/sidebar.tsx): filtra aqui,
  // no client, para nunca tentar serializar um componente de ícone do
  // Server Component pai para este Client Component via prop.
  const navGroups = filterNavGroupsByPermission(navPermissions);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
            <MenuIcon />
          </Button>
        }
      />
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-4 py-3.5">
          <SheetTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PackageCheckIcon className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Patrium</span>
              <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Portal Empresa
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
          {navGroups.map((group) => (
            <div key={group.label} className="grid gap-1">
              <span className="px-2.5 text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">
                {group.label}
              </span>
              {group.items.map((entry) => {
                if (entry.kind === "link") {
                  return (
                    <NavLink
                      key={entry.href}
                      item={entry}
                      isActive={entry.href === activeHref}
                      onNavigate={() => setOpen(false)}
                    />
                  );
                }

                const submenuActive = isSubmenuActive(pathname, entry);
                const SubmenuIcon = entry.icon;
                return (
                  <Collapsible key={entry.label} defaultOpen={submenuActive}>
                    <CollapsibleTrigger
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        submenuActive && "text-foreground",
                      )}
                    >
                      <SubmenuIcon className="size-4" />
                      <span className="flex-1 text-left">{entry.label}</span>
                      <ChevronDownIcon className="size-3.5 transition-transform group-data-panel-open:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-1 overflow-hidden pl-4 data-starting-style:h-0 data-ending-style:h-0">
                      {entry.items.map((item) => (
                        <NavLink
                          key={item.href}
                          item={item}
                          isActive={item.href === activeHref}
                          onNavigate={() => setOpen(false)}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
