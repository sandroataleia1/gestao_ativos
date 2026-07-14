import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getUnresolvedProvisionalLinks } from "@/lib/company-claim";
import { prisma } from "@/lib/prisma";
import { ClaimReviewPanel } from "./claim-review-panel";

export const metadata: Metadata = {
  title: "Revisar acesso de consultorias — Gestão de Ativos",
};

// Sprint Comercial SST 1.4, §16-§19 — passo obrigatório de onboarding
// quando o CNPJ cadastrado já tinha um pré-cadastro de uma consultoria SST.
// Só chega aqui uma empresa com `controlStatus: CLAIM_PENDING` (ver
// app/(app)/layout.tsx, que redireciona para cá) — se por algum motivo não
// houver mais nada pendente (já resolvido em outra aba, por exemplo),
// manda para o dashboard normal em vez de mostrar uma tela vazia.
export default async function OnboardingSstProvidersPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.SST_PROVIDER_MANAGE);

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, controlStatus: true },
  });
  if (company.controlStatus !== "CLAIM_PENDING") {
    redirect("/dashboard");
  }

  const links = await getUnresolvedProvisionalLinks(companyId);
  if (links.length === 0) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto grid min-h-full max-w-2xl place-items-center p-6">
      <div className="grid w-full gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Revisar acesso de consultorias SST</h1>
          <p className="text-sm text-muted-foreground">
            {company.name} tem um pré-cadastro feito por uma consultoria de Segurança do Trabalho.
            Os dados pertencem à sua empresa — decida se continua autorizando cada consultoria
            abaixo ou bloqueia o acesso.
          </p>
        </div>

        <ClaimReviewPanel
          links={links.map((link) => ({
            id: link.id,
            providerName: link.providerName,
            accessLevel: link.accessLevel,
          }))}
        />
      </div>
    </div>
  );
}
