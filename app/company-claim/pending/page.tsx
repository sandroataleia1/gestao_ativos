import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuthOrDeny } from "@/lib/auth-server";
import { getActiveClaimRequestForUser } from "@/lib/company-claim-request";
import { maskCnpjForLog } from "@/lib/cnpj";
import { ClaimPendingPanel } from "./claim-pending-panel";

export const metadata: Metadata = {
  title: "Solicitação em análise — Gestão de Ativos",
};

// Página deliberadamente FORA de app/(app)/** (mesmo motivo de
// /select-company, ver aquele arquivo): o layout do Portal Empresa exige
// requireCompanyOrDeny(), que redireciona PARA CÁ quando há uma
// CompanyClaimRequest ativa — colocar esta página dentro de (app) criaria
// um loop. Exige só sessão (requireAuthOrDeny()), nunca requireCompany().
//
// Sprint SST 1.4C, §10 — mostra apenas o mínimo necessário (situação, data,
// nome/CNPJ mascarado da empresa, orientação, sair, cancelar). NUNCA
// colaboradores/treinamentos/ativos/documentos/consultorias/usuários/
// quantidade de dados/nível de acesso de consultoria — nenhuma dessas
// informações é sequer consultada aqui.
export default async function CompanyClaimPendingPage() {
  const user = await requireAuthOrDeny();

  const claim = await getActiveClaimRequestForUser(user.id);
  // Sem claim ativa (já resolvida em outra aba, por exemplo) — manda para
  // o dashboard normal, que por sua vez decide o destino certo (Portal
  // Empresa se já houver membership ACTIVE, ou o ForbiddenError genérico
  // caso realmente não haja nada). Nunca mostra uma tela vazia aqui.
  if (!claim) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto grid min-h-screen max-w-lg place-items-center p-6">
      <div className="grid w-full gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Solicitação em análise</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Recebemos sua solicitação para administrar esta empresa. O acesso aos dados será
            liberado somente após a validação da representação empresarial.
          </p>
        </div>

        <ClaimPendingPanel
          claim={{
            id: claim.id,
            status: claim.status,
            requestedAt: claim.requestedAt.toISOString(),
            companyName: claim.company.name,
            cnpjMasked: claim.company.documentNormalized ? maskCnpjForLog(claim.company.documentNormalized) : null,
          }}
        />
      </div>
    </div>
  );
}
