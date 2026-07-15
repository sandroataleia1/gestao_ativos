import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuthOrDeny } from "@/lib/auth-server";
import { getMostRecentClaimForPage } from "@/lib/company-claim-request";
import { maskCnpjForLog } from "@/lib/cnpj";
import { ClaimPendingPanel } from "./claim-pending-panel";

export const metadata: Metadata = {
  title: "Solicitação em análise — Gestão de Ativos",
};

const TITLES: Record<string, string> = {
  PENDING: "Solicitação em análise",
  UNDER_REVIEW: "Solicitação em análise",
  DISPUTED: "Solicitação requer análise adicional",
  APPROVED: "Solicitação aprovada",
  REJECTED: "Solicitação não aprovada",
  CANCELLED: "Solicitação cancelada",
  EXPIRED: "Solicitação expirada",
};

// Página deliberadamente FORA de app/(app)/** (mesmo motivo de
// /select-company, ver aquele arquivo): o layout do Portal Empresa exige
// requireCompanyOrDeny(), que redireciona PARA CÁ quando há uma
// CompanyClaimRequest PENDING/UNDER_REVIEW — colocar esta página dentro de
// (app) criaria um loop. Exige só sessão (requireAuthOrDeny()), nunca
// requireCompany().
//
// Sprint SST 1.4C.1, §9 — cobre TODOS os estados possíveis de uma
// CompanyClaimRequest (o guard central só redireciona PARA CÁ em
// PENDING/UNDER_REVIEW, mas o usuário pode chegar aqui por link
// direto/histórico do navegador depois de a solicitação já ter sido
// decidida) — nunca mostra uma tela quebrada nem redireciona cegamente pro
// dashboard sem checar o estado real primeiro. Mostra apenas o mínimo
// necessário (situação, data, nome/CNPJ mascarado da empresa, orientação,
// sair, cancelar quando permitido). NUNCA colaboradores/treinamentos/
// ativos/documentos/consultorias/usuários/quantidade de dados/nível de
// acesso de consultoria/identidade do outro solicitante em disputa —
// nenhuma dessas informações é sequer consultada aqui.
export default async function CompanyClaimPendingPage() {
  const user = await requireAuthOrDeny();

  const claim = await getMostRecentClaimForPage(user.id);
  // Nunca teve nenhuma solicitação — nada para acompanhar aqui. Manda para
  // o dashboard normal, que decide o destino certo por conta própria.
  if (!claim) {
    redirect("/dashboard");
  }

  // §9 — "não liberar por causa somente do status do claim": mesmo com
  // status APPROVED, só oferece "Entrar na empresa" quando a
  // CompanyMembership ACTIVE realmente existe (hasActiveMembership,
  // conferido no servidor por getMostRecentClaimForPage). Se por algum
  // motivo raro a claim está APPROVED mas a membership ainda não existe,
  // a página trata como se estivesse em análise — nunca finge sucesso.
  const effectiveStatus =
    claim.status === "APPROVED" && !claim.hasActiveMembership ? "UNDER_REVIEW" : claim.company.controlStatus === "DISPUTED" && (claim.status === "PENDING" || claim.status === "UNDER_REVIEW") ? "DISPUTED" : claim.status;

  const title = TITLES[effectiveStatus] ?? "Solicitação de reivindicação";

  return (
    <div className="mx-auto grid min-h-screen max-w-lg place-items-center p-6">
      <div className="grid w-full gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Recebemos sua solicitação para administrar esta empresa. O acesso aos dados será
            liberado somente após a validação da representação empresarial.
          </p>
        </div>

        <ClaimPendingPanel
          claim={{
            id: claim.id,
            status: effectiveStatus,
            requestedAt: claim.requestedAt.toISOString(),
            companyName: claim.company.name,
            cnpjMasked: claim.company.documentNormalized ? maskCnpjForLog(claim.company.documentNormalized) : null,
          }}
        />
      </div>
    </div>
  );
}
