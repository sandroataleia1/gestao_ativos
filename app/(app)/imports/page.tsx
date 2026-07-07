import type { Metadata } from "next";

import { hasPermission, requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { ImportsTabs } from "./imports-tabs";

export const metadata: Metadata = {
  title: "Importações — Gestão de Ativos",
};

export default async function ImportsPage() {
  await requirePermissionOrDeny(PERMISSIONS.IMPORT_VIEW);
  const canManage = await hasPermission(PERMISSIONS.IMPORT_MANAGE);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Importações</h1>
        <p className="text-sm text-muted-foreground">
          Traga colaboradores, ativos e estoque inicial de uma planilha Excel para acelerar o cadastro.
        </p>
      </div>

      <ImportsTabs canManage={canManage} />
    </div>
  );
}
