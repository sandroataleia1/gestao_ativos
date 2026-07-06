import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, ValidationError } from "@/lib/api-errors";
import { createEvolutionInstance, getEvolutionConnectionQr } from "@/lib/evolution-api";

// Idempotente: na primeira chamada cria a instância (nome determinístico
// `company-{companyId}`, nunca duplica); nas chamadas seguintes (refresh de
// QR — o QR do Baileys expira em segundos) só busca um QR novo da instância
// já salva. Usado tanto pelo clique inicial de "Conectar WhatsApp" quanto
// pelo polling de refresh em app/(app)/configuracoes/whatsapp-connect-panel.tsx.
export async function POST() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { whatsappInstanceName: true, whatsappApiKey: true },
    });

    if (!company.whatsappInstanceName || !company.whatsappApiKey) {
      const instanceName = `company-${companyId}`;
      const created = await createEvolutionInstance(instanceName);
      if (!created.ok) throw new ValidationError(created.error);

      await prisma.company.update({
        where: { id: companyId },
        data: {
          whatsappApiUrl: process.env.EVOLUTION_API_URL ?? null,
          whatsappApiKey: created.apiKey,
          whatsappInstanceName: instanceName,
        },
      });

      return NextResponse.json({ state: "connecting", qrCodeBase64: created.qrCodeBase64 });
    }

    const qr = await getEvolutionConnectionQr(company.whatsappInstanceName, company.whatsappApiKey);
    if (!qr.ok) throw new ValidationError(qr.error);

    return NextResponse.json({ state: qr.state, qrCodeBase64: qr.qrCodeBase64 });
  } catch (error) {
    return handleApiError(error);
  }
}
