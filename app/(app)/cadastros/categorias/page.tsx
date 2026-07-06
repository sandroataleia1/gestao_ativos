import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { hasPermission, requireAuthOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { LookupManager } from "../lookup-manager";
import { CATEGORY_CONFIG } from "../configs";
import type { LookupRow } from "../types";

export const metadata: Metadata = {
  title: "Categorias — Gestão de Ativos",
};

export default async function CategoriasPage() {
  const user = await requireAuthOrDeny();
  const canManage = await hasPermission(PERMISSIONS.CATEGORY_MANAGE);
  if (!canManage) forbidden();

  const categories = await prisma.assetCategory.findMany({
    where: { companyId: user.companyId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Categorias</h1>
        <p className="text-sm text-muted-foreground">{CATEGORY_CONFIG.description}</p>
      </div>

      <LookupManager config={CATEGORY_CONFIG} initialRows={categories as LookupRow[]} canManage={canManage} />
    </div>
  );
}
