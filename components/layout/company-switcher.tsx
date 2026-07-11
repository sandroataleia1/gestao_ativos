"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SwitchableCompany = { companyId: string; companyName: string };

// Sprint 0.6, Parte E — só é renderizado pelo Header quando há mais de uma
// empresa selecionável (uma única empresa não precisa de seletor). A troca
// SEMPRE passa pela API (nunca decide sozinho no client) e recarrega a
// página inteira (não só router.refresh()) — garante que nenhum cache de
// Client Component do tenant anterior sobreviva à troca.
export function CompanySwitcher({
  currentCompanyId,
  companies,
}: {
  currentCompanyId: string;
  companies: SwitchableCompany[];
}) {
  const [isSwitching, setIsSwitching] = useState(false);
  const current = companies.find((c) => c.companyId === currentCompanyId);

  async function handleSwitch(companyId: string) {
    if (companyId === currentCompanyId || isSwitching) return;
    setIsSwitching(true);
    const res = await fetch("/api/company-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) {
      setIsSwitching(false);
      return;
    }
    // Navegação de página inteira (não SPA) — descarta qualquer estado/cache
    // de Client Component renderizado sob o tenant anterior.
    window.location.assign("/dashboard");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1" disabled={isSwitching}>
            {isSwitching ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">Trocar empresa</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Suas empresas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => (
          <DropdownMenuItem key={company.companyId} onClick={() => handleSwitch(company.companyId)}>
            {company.companyId === current?.companyId ? (
              <CheckIcon className="size-4" />
            ) : (
              <span className="size-4" />
            )}
            {company.companyName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
