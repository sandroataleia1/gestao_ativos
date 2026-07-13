"use client";

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SwitchableCompany = { companyId: string; companyName: string };

// Sprint Demo Comercial SST 1.2, Parte 5 — o próprio nome da empresa ativa
// é o gatilho do seletor (era um botão "Trocar empresa" separado, pequeno e
// pouco descoberto). A troca SEMPRE passa pela API (nunca decide sozinho no
// client) e recarrega a página inteira (não só router.refresh()) — garante
// que nenhum cache de Client Component do tenant anterior sobreviva à troca.
export function CompanySwitcher({
  currentCompanyId,
  companies,
  activeEmployeeCount,
}: {
  currentCompanyId: string;
  companies: SwitchableCompany[];
  activeEmployeeCount: number;
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
          <button
            type="button"
            disabled={isSwitching}
            aria-label={`${current?.companyName ?? "Empresa ativa"} — trocar empresa`}
            title="Trocar empresa"
            className="group flex items-center gap-2 rounded-lg px-1.5 py-1 leading-tight transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="text-left">
              <span className="flex items-center gap-1 text-sm font-semibold">
                {current?.companyName ?? "—"}
                {isSwitching ? (
                  <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
                )}
              </span>
              <span className="block text-xs text-muted-foreground">
                {activeEmployeeCount} colaborador{activeEmployeeCount === 1 ? "" : "es"} ativo
                {activeEmployeeCount === 1 ? "" : "s"}
              </span>
            </span>
          </button>
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
