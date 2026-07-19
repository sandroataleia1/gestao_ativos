"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/sst/dashboard", label: "Visão geral" },
  { href: "/sst/companies", label: "Empresas" },
  { href: "/sst/settings/team", label: "Equipe" },
] as const;

// Navegação principal do Portal Consultoria — Sprint Demo Comercial SST 1.0,
// Parte 4. Extraído como Client Component só para poder usar usePathname()
// e destacar o item ativo (o layout em si continua Server Component). Só
// itens com conteúdo funcional real — "Treinamentos"/"Configurações" ficam
// de fora nesta sprint por não terem uma página própria no nível do portal
// (treinamentos hoje só existem dentro de uma empresa específica).
export function SstNav() {
  const pathname = usePathname();

  return (
    // Fundo da topbar é verde-esmeralda escuro (identidade do Portal SST) —
    // os links precisam do mesmo tratamento claro/escuro pra continuar
    // legíveis, mesmo raciocínio de contraste usado na sidebar do Portal
    // Empresa (components/layout/sidebar.tsx, NavLink).
    <nav className="flex items-center gap-1 text-sm font-medium text-emerald-100/70 dark:text-muted-foreground">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors hover:bg-white/10 hover:text-white dark:hover:bg-muted dark:hover:text-foreground",
              isActive &&
                "bg-white/10 text-white hover:bg-white/15 hover:text-white dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/15 dark:hover:text-primary",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
