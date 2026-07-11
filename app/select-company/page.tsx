import type { Metadata } from "next";

import { requireAuthOrDeny, resolveCurrentCompanyContext } from "@/lib/auth-server";
import { listAvailableCompanyContexts, listPendingCompanyInvitations } from "@/lib/company-selection";
import { SelectCompanyPanel } from "./select-company-panel";

export const metadata: Metadata = {
  title: "Selecionar empresa — Gestão de Ativos",
};

// Página deliberadamente FORA de app/(app)/** (Sprint 0.6, Parte D): o
// layout do Portal Empresa (app/(app)/layout.tsx) exige `requireCompanyOrDeny()`
// — colocar o seletor lá dentro criaria um loop (SELECTION_REQUIRED redireciona
// pra cá, mas o próprio layout já bloquearia antes de chegar aqui). Esta
// página exige só sessão (`requireAuthOrDeny()`), nunca `requireCompany()`,
// e nunca depende do cookie `active_company_id` estar válido — funciona
// mesmo com ele ausente, expirado, ou apontando para uma empresa/membership
// que não é mais válida (é exatamente o caminho de recuperação desses casos).
export default async function SelectCompanyPage() {
  const user = await requireAuthOrDeny();

  const [availableCompanies, pendingInvitations, currentContext] = await Promise.all([
    listAvailableCompanyContexts(user.id),
    listPendingCompanyInvitations(user.id),
    // Não-lançável: se o cookie atual for inválido/ambíguo, isto só volta
    // um status diferente de RESOLVED — nunca quebra a página.
    resolveCurrentCompanyContext(),
  ]);

  const currentCompanyId = currentContext?.status === "RESOLVED" ? currentContext.companyId : null;

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/30 p-6">
      <div className="w-full max-w-lg pt-10">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold">Selecionar empresa</h1>
          <p className="text-sm text-muted-foreground">
            Olá, {user.name}. Escolha em qual empresa você quer trabalhar agora.
          </p>
        </div>

        <SelectCompanyPanel
          availableCompanies={availableCompanies}
          pendingInvitations={pendingInvitations}
          currentCompanyId={currentCompanyId}
        />
      </div>
    </div>
  );
}
