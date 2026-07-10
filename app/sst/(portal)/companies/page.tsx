import type { Metadata } from "next";
import Link from "next/link";
import { BuildingIcon } from "lucide-react";

import { requireSstAuthOrDeny } from "@/lib/sst-auth";
import { getLinkedCompaniesWithMetrics } from "@/lib/sst-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ComplianceStatusBadge } from "@/app/sst/compliance-badge";

export const metadata: Metadata = {
  title: "Empresas — Portal Consultoria SST",
};

// Só empresas com SstProviderCompany.status ACTIVE para o provider da
// sessão — nunca lista uma empresa sem vínculo ACTIVE.
export default async function SstCompaniesPage() {
  const { providerId } = await requireSstAuthOrDeny();
  const companies = await getLinkedCompaniesWithMetrics(providerId);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Empresas</h1>
        <p className="text-sm text-muted-foreground">Empresas que autorizaram sua consultoria.</p>
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BuildingIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">Nenhuma empresa autorizada ainda.</p>
            <p className="text-sm text-muted-foreground">
              Peça para uma empresa autorizar sua consultoria em Configurações → Prestadores SST.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {companies.map((company) => (
            <li key={company.companyId}>
              <Card>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{company.companyName}</span>
                      <ComplianceStatusBadge status={company.complianceStatus} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{company.activeEmployeeCount} colaborador(es) ativo(s)</span>
                      <span>{company.activeTrainingCount} treinamento(s)</span>
                      <span>{company.expiredCount} vencido(s)</span>
                      <span>{company.expiringSoonCount} vencendo em 30 dias</span>
                      <span>{company.scheduledClassCount} turma(s) agendada(s)</span>
                      <span>Índice: {company.complianceScore}%</span>
                    </div>
                  </div>
                  <Button size="sm" render={<Link href={`/sst/companies/${company.companyId}`} />}>
                    Entrar
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
