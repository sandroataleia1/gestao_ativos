import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { ComplianceStatusBadge } from "@/app/sst/compliance-badge";
import type { SstComplianceStatus, SstLinkedCompanySummary } from "@/lib/sst-dashboard";
import { pluralize } from "@/lib/plural";
import { buildPendencySummary, buildSecondaryInfo } from "@/lib/sst-companies-list";

// Sprint Demo Comercial SST 1.3, Parte 11 — rótulos de nível de acesso mais
// descritivos, sem alterar o enum `SstProviderCompanyAccessLevel` (só
// apresentação).
const ACCESS_LEVEL_LABELS: Record<string, string> = {
  VIEW: "Acesso de consulta",
  OPERATION: "Acesso operacional",
  ADMINISTRATION: "Acesso administrativo",
};

const RELATIONSHIP_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  PENDING: "Pendente",
  SUSPENDED: "Suspenso",
  REVOKED: "Revogado",
};

// Mesmas famílias de cor do badge de situação (app/sst/compliance-badge.tsx)
// — a barra de conformidade nunca usa uma paleta diferente da que já
// classifica Crítica/Atenção/Em dia (Sprint 1.3, Parte 9: "não criar duas
// regras diferentes de classificação").
const PROGRESS_INDICATOR_CLASSNAME: Record<SstComplianceStatus, string> = {
  CRITICA: "bg-destructive",
  ATENCAO: "bg-amber-500 dark:bg-amber-600",
  EM_DIA: "bg-emerald-500 dark:bg-emerald-600",
};

export function CompanyListItem({ company }: { company: SstLinkedCompanySummary }) {
  const secondaryInfo = buildSecondaryInfo(company);

  return (
    // Hover discreto no container em vez de um <a> envolvendo o card
    // inteiro — o card já contém um link (Abrir empresa) e aninhar outro
    // ao redor dele seria HTML inválido (Sprint 1.3, Parte 12). `size="sm"`
    // + gaps reduzidos (Parte 15: "não transformar cada empresa em um card
    // excessivamente alto") — a barra de conformidade também ganhou uma
    // largura máxima menor para não esticar a linha.
    <Card size="sm" className="transition-colors hover:border-primary/40 hover:bg-muted/30">
      <CardContent className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Nome em destaque no topo do card, com as demais informações
              (situação, vínculo, acesso) logo abaixo — em vez de competir na
              mesma linha (o que causava quebra desorganizada em colunas mais
              estreitas do grid). */}
          <div className="grid gap-1.5">
            <span className="text-base font-semibold leading-tight">{company.companyName}</span>
            <div className="flex flex-wrap items-center gap-2">
              <ComplianceStatusBadge status={company.complianceStatus} />
              <Badge variant="outline">
                {RELATIONSHIP_STATUS_LABELS[company.relationshipStatus] ?? company.relationshipStatus}
              </Badge>
              <Badge variant="secondary">{ACCESS_LEVEL_LABELS[company.accessLevel] ?? company.accessLevel}</Badge>
            </div>
          </div>
          <Button
            size="sm"
            aria-label={`Abrir empresa ${company.companyName}`}
            render={<Link href={`/sst/companies/${company.companyId}`} />}
          >
            Abrir empresa
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm text-muted-foreground">
            {pluralize(company.activeEmployeeCount, "colaborador ativo", "colaboradores ativos")} ·{" "}
            {buildPendencySummary(company)}
          </p>

          <div className="grid w-full max-w-56 gap-0.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Conformidade de treinamentos</span>
              <span className="font-medium text-foreground">{company.complianceScore}%</span>
            </div>
            <Progress value={company.complianceScore} aria-valuetext={`${company.complianceScore}% de conformidade`}>
              <ProgressTrack>
                <ProgressIndicator className={PROGRESS_INDICATOR_CLASSNAME[company.complianceStatus]} />
              </ProgressTrack>
            </Progress>
          </div>
        </div>

        {secondaryInfo.length > 0 ? (
          <p className="text-xs text-muted-foreground/80">{secondaryInfo.join(" · ")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
