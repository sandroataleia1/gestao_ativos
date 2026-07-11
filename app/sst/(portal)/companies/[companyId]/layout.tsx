import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireSstProviderCompanyAccessOrDeny } from "@/lib/sst-auth";
import { CompanyNavTabs } from "./company-nav-tabs";

// Navegação contextual da empresa selecionada — Alertas/Relatórios ficam de
// fora de propósito (fora de escopo desta sprint, ver
// docs/portal-consultoria.md): nenhum link deve apontar para uma página que
// não existe. requireSstProviderCompanyAccessOrDeny aqui garante que todas
// as rotas abaixo (resumo, colaboradores, treinamentos, turmas e suas
// subpáginas) já passam por essa checagem antes de renderizar — páginas
// filhas ainda fazem suas próprias checagens de accessLevel específicas
// (view/operation/administration) para decidir o que exibir.
//
// Breadcrumb (Sprint Demo Comercial SST 1.0, Parte 4): "Empresas > Nome da
// empresa" — antes só havia o link "← Empresas" sem contexto de hierarquia.
export default async function SstCompanyScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await requireSstProviderCompanyAccessOrDeny(companyId);

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  if (!company) notFound();

  return (
    <div className="grid gap-4">
      <div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/sst/companies" className="hover:text-foreground">
            Empresas
          </Link>
          <ChevronRightIcon className="size-3.5" />
          <span className="text-foreground">{company.name}</span>
        </div>
        <h1 className="text-lg font-semibold">{company.name}</h1>
      </div>

      <CompanyNavTabs companyId={companyId} />

      {children}
    </div>
  );
}
