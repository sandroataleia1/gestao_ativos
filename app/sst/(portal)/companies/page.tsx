import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { getLinkedCompaniesWithMetrics } from "@/lib/sst-dashboard";
import { Button } from "@/components/ui/button";
import { SstCompaniesList } from "./companies-list";

export const metadata: Metadata = {
  title: "Empresas — Portal Consultoria SST",
};

// Só empresas com SstProviderCompany.status ACTIVE para o provider da
// sessão — nunca lista uma empresa sem vínculo ACTIVE. Busca, filtro de
// situação e filtro de pendências são resolvidos no client
// (SstCompaniesList) porque o volume por consultoria é pequeno — não há
// necessidade de paginação server-side nesta sprint.
//
// "Adicionar empresa" (pré-cadastro por CNPJ, Sprint Comercial SST 1.4,
// §9/§10) só aparece para OWNER — TECHNICIAN/VIEWER não podem iniciar
// pré-cadastro nem solicitação de acesso.
export default async function SstCompaniesPage() {
  const ctx = await requireSstAuthOrDeny();
  const companies = await getLinkedCompaniesWithMetrics(ctx.providerId);
  const isOwner = ctx.sstProviderUser.role === "OWNER";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe as empresas vinculadas à sua consultoria e identifique onde agir primeiro.
          </p>
        </div>
        {isOwner ? (
          <Button render={<Link href="/sst/companies/new" />}>
            <PlusIcon />
            Adicionar empresa
          </Button>
        ) : null}
      </div>

      <SstCompaniesList companies={companies} />
    </div>
  );
}
