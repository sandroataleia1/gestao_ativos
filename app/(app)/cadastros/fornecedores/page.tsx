import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { LookupManager } from "../lookup-manager";
import { SUPPLIER_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Fornecedores — Gestão de Ativos",
};

export default async function FornecedoresPage() {
  const user = await requireAuthOrDeny();
  const canManage = await hasPermission(PERMISSIONS.SUPPLIER_MANAGE);
  if (!canManage) forbidden();

  const suppliers = await prisma.supplier.findMany({
    where: { companyId: user.companyId },
    orderBy: { corporateName: "asc" },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fornecedores</h1>
        <p className="text-sm text-muted-foreground">{SUPPLIER_CONFIG.description}</p>
      </div>

      <LookupManager config={SUPPLIER_CONFIG} initialRows={suppliers as LookupRow[]} canManage={canManage} />
    </div>
  );
}
