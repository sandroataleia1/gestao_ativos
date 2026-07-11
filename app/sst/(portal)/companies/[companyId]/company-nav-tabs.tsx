"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TAB_ITEMS = [
  { href: "", label: "Resumo" },
  { href: "/employees", label: "Colaboradores" },
  { href: "/trainings", label: "Treinamentos" },
  { href: "/classes", label: "Turmas" },
] as const;

// Abas da empresa selecionada — Sprint Demo Comercial SST 1.0, Parte 4:
// antes nenhuma aba era destacada como ativa (mesma classe sempre),
// deixando o usuário sem noção de onde está. Client Component só para
// poder usar usePathname() (o layout pai continua Server Component).
export function CompanyNavTabs({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const base = `/sst/companies/${companyId}`;

  return (
    <nav className="flex flex-wrap gap-1 border-b">
      {TAB_ITEMS.map((item) => {
        const href = `${base}${item.href}`;
        // "Resumo" (href = "") só fica ativo na página exata; as demais
        // abas também cobrem suas subpáginas (ex.: /trainings/new).
        const isActive = item.href === "" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={item.label}
            href={href}
            className={cn(
              "rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              isActive && "border-primary text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
