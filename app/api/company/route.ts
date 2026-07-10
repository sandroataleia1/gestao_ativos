import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { companyProfileInputSchema } from "@/lib/validations/company";

// Painel completo da empresa (app/(app)/configuracoes/empresa) — só ADMIN
// (COMPANY_MANAGE). Esses dados alimentam os termos de custódia, a página
// de QR Code e o cabeçalho do app (ver docs — nenhum dado de linha/planilha
// aqui, então não há preocupação de dado sensível além do já tratado no
// resto do app).
export async function PATCH(request: Request) {
  try {
    const { companyId, user } = await requirePermission(PERMISSIONS.COMPANY_MANAGE);
    const body = companyProfileInputSchema.parse(await request.json());

    const company = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          name: body.name,
          tradeName: body.tradeName,
          document: body.document,
          email: body.email,
          phone: body.phone,
          address: body.address,
          city: body.city,
          state: body.state,
          zipCode: body.zipCode,
          responsibleName: body.responsibleName,
          ...(body.logoDataUrl !== undefined ? { logoDataUrl: body.logoDataUrl } : {}),
        },
      });

      // Nunca grava o valor da logo em si nos metadados — só se ela mudou.
      await logAudit(tx, {
        companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "company.update",
        targetType: "Company",
        targetId: companyId,
        metadata: { logoChanged: body.logoDataUrl !== undefined },
      });

      return updated;
    });

    return NextResponse.json({ company });
  } catch (error) {
    return handleApiError(error);
  }
}
