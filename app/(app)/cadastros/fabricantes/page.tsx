import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { LookupManager } from "../lookup-manager";
import { MANUFACTURER_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Fabricantes — Gestão de Ativos",
};

export default async function FabricantesPage() {
  const user = await requireAuthOrDeny();
  const canManage = await hasPermission(PERMISSIONS.MANUFACTURER_MANAGE);
  if (!canManage) forbidden();

  const manufacturers = await prisma.manufacturer.findMany({
    where: { companyId: user.companyId, deletedAt: null },
    orderBy: { name: "asc" },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fabricantes</h1>
        <p className="text-sm text-muted-foreground">{MANUFACTURER_CONFIG.description}</p>
      </div>

      <LookupManager
        config={MANUFACTURER_CONFIG}
        initialRows={manufacturers as LookupRow[]}
        canManage={canManage}
      />
    </div>
  );
}
