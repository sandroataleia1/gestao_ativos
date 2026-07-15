import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePlatformRole } from "@/lib/platform-auth";
import { getCompanyClaimDetailForAdmin } from "@/lib/platform-admin-detail";
import { recordClaimViewed } from "@/lib/platform-admin-claims";
import { ClaimDetailPanel } from "./claim-detail-panel";

export const metadata: Metadata = {
  title: "Detalhe da reivindicação — Administração da plataforma",
};

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4D, §9 — a página NÃO permite editar diretamente Company/
// User/CompanyMembership/SstProviderCompany; toda decisão passa pelos
// serviços de domínio (via API abaixo, chamados pelo painel client). Nunca
// consulta colaboradores/treinamentos/ativos/estoque/custódias/documentos/
// assinaturas/fotos/dados médicos.
export default async function PlatformAdminCompanyClaimDetailPage({ params }: RouteParams) {
  const { user } = await requirePlatformRole("SUPER_ADMIN");
  const { id } = await params;

  const detail = await getCompanyClaimDetailForAdmin(id);
  if (!detail) notFound();

  // §17 — "claim_viewed" deduplicado (nunca um evento por render/refresh),
  // resolvido dentro de recordClaimViewed.
  await recordClaimViewed({ claimRequestId: detail.claim.id, companyId: detail.company.id, viewer: { id: user.id, name: user.name } });

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <ClaimDetailPanel detail={detail} />
    </div>
  );
}
