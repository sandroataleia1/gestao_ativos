import type { Metadata } from "next";

import { requireSstRoleOrDeny } from "@/lib/sst-auth";
import { AddCompanyForm } from "./add-company-form";

export const metadata: Metadata = {
  title: "Adicionar empresa — Portal Consultoria SST",
};

// Sprint Comercial SST 1.4, §9/§10 — só OWNER pode iniciar pré-cadastro de
// empresa ou solicitação de autorização (verificação de CNPJ inclusa).
export default async function SstAddCompanyPage() {
  await requireSstRoleOrDeny("OWNER");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Adicionar empresa</h1>
        <p className="text-sm text-muted-foreground">
          Informe o CNPJ da empresa para pré-cadastrá-la ou solicitar autorização, caso ela já
          esteja cadastrada na plataforma.
        </p>
      </div>

      <AddCompanyForm />
    </div>
  );
}
