import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { whatsappConfigInputSchema } from "@/lib/validations/company";

// Config da Evolution API (WhatsApp) é por empresa (ver comentário no model
// Company) — gated por USER_MANAGE (a permissão mais "admin" já existente
// no catálogo, atribuída só ao papel ADMIN por padrão) por não haver ainda
// uma permissão dedicada de "gestão da empresa" no sistema.
export async function PUT(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const body = await request.json();
    const input = whatsappConfigInputSchema.parse(body);

    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        whatsappApiUrl: input.whatsappApiUrl ?? null,
        whatsappApiKey: input.whatsappApiKey ?? null,
        whatsappInstanceName: input.whatsappInstanceName ?? null,
      },
      select: { whatsappApiUrl: true, whatsappApiKey: true, whatsappInstanceName: true },
    });

    return NextResponse.json({ company });
  } catch (error) {
    return handleApiError(error);
  }
}
