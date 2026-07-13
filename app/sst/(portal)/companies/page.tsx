import type { Metadata } from "next";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { getLinkedCompaniesWithMetrics } from "@/lib/sst-dashboard";
import { SstCompaniesList } from "./companies-list";

export const metadata: Metadata = {
  title: "Empresas — Portal Consultoria SST",
};

// Só empresas com SstProviderCompany.status ACTIVE para o provider da
// sessão — nunca lista uma empresa sem vínculo ACTIVE. Busca, filtro de
// situação e filtro de pendências são resolvidos no client
// (SstCompaniesList) porque o volume por consultoria é pequeno — não há
// necessidade de paginação server-side nesta sprint.
export default async function SstCompaniesPage() {
  const { providerId } = await requireSstAuthOrDeny();
  const companies = await getLinkedCompaniesWithMetrics(providerId);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Empresas</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe as empresas vinculadas à sua consultoria e identifique onde agir primeiro.
        </p>
      </div>

      <SstCompaniesList companies={companies} />
    </div>
  );
}
