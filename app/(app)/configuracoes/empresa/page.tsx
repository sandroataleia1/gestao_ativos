import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrDeny } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { CompanyProfileForm } from "./company-profile-form";

export const metadata: Metadata = {
  title: "Empresa — Gestão de Ativos",
};

export default async function CompanyProfilePage() {
  const { companyId } = await requirePermissionOrDeny(PERMISSIONS.COMPANY_MANAGE);

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true,
      tradeName: true,
      document: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
      responsibleName: true,
      logoDataUrl: true,
    },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Empresa</h1>
        <p className="text-sm text-muted-foreground">
          Esses dados aparecem nos termos de custódia, na página de QR Code e no cabeçalho do sistema.
        </p>
      </div>

      <CompanyProfileForm company={company} />
    </div>
  );
}
