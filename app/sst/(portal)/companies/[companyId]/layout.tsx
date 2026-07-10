import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireSstProviderCompanyAccessOrDeny } from "@/lib/sst-auth";

const NAV_ITEMS = [
  { href: "", label: "Resumo" },
  { href: "/employees", label: "Colaboradores" },
  { href: "/trainings", label: "Treinamentos" },
  { href: "/classes", label: "Turmas" },
] as const;

// Navegação contextual da empresa selecionada — Alertas/Relatórios ficam de
// fora de propósito (fora de escopo desta sprint, ver
// docs/portal-consultoria.md): nenhum link deve apontar para uma página que
// não existe. requireSstProviderCompanyAccessOrDeny aqui garante que todas
// as rotas abaixo (resumo, colaboradores, treinamentos, turmas e suas
// subpáginas) já passam por essa checagem antes de renderizar — páginas
// filhas ainda fazem suas próprias checagens de accessLevel específicas
// (view/operation/administration) para decidir o que exibir.
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
        <Link href="/sst/companies" className="text-sm text-muted-foreground hover:text-foreground">
          ← Empresas
        </Link>
        <h1 className="text-lg font-semibold">{company.name}</h1>
      </div>

      <nav className="flex flex-wrap gap-1 border-b">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={`/sst/companies/${companyId}${item.href}`}
            className="rounded-t-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
