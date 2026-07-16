"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Sprint SST 1.4D, §6 — navegação mínima do Portal Super Admin Lite.
// Deliberadamente curta: só o que esta sprint entrega de fato (visão geral
// + reivindicações). Nada de gestão completa de empresas/consultorias/
// billing/métricas — fora de escopo desta sprint.
const NAV_ITEMS = [
  { href: "/platform-admin", label: "Visão geral" },
  { href: "/platform-admin/company-claims", label: "Reivindicações" },
  { href: "/platform-admin/audit", label: "Auditoria" },
] as const;

export function PlatformAdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm font-medium text-zinc-400">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/platform-admin" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors hover:bg-white/10 hover:text-white",
              isActive && "bg-white/10 text-white hover:bg-white/15",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
