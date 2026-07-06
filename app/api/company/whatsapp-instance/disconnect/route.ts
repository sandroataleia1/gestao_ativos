import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { deleteEvolutionInstance } from "@/lib/evolution-api";

// Remove a instância na Evolution API e limpa os 3 campos da empresa —
// depois disso, um novo POST em .../connect recria do zero (mesmo nome
// determinístico `company-{companyId}`).
export async function POST() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { whatsappInstanceName: true },
    });

    if (company.whatsappInstanceName) {
      await deleteEvolutionInstance(company.whatsappInstanceName);
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { whatsappApiUrl: null, whatsappApiKey: null, whatsappInstanceName: null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
