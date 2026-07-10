import type { Metadata } from "next";

import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getProviderLinksForCompany } from "@/lib/sst-providers";
import { SstProvidersPanel } from "./sst-providers-panel";

export const metadata: Metadata = {
  title: "Prestadores SST — Gestão de Ativos",
};

export default async function SstProvidersPage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.SST_PROVIDER_VIEW);
  const canManage = await hasPermission(PERMISSIONS.SST_PROVIDER_MANAGE);

  const links = await getProviderLinksForCompany(companyId);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Prestadores SST</h1>
        <p className="text-sm text-muted-foreground">
          Consultorias/prestadores de Segurança do Trabalho autorizados a gerenciar treinamentos
          desta empresa.
        </p>
      </div>

      <SstProvidersPanel
        initialLinks={links.map((link) => ({
          id: link.id,
          status: link.status,
          accessLevel: link.accessLevel,
          createdAt: link.createdAt.toISOString(),
          provider: link.provider,
        }))}
        canManage={canManage}
      />
    </div>
  );
}
