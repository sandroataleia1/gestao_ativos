import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { custodySignatureInputSchema } from "@/lib/validations/custody-document";

type RouteParams = { params: Promise<{ id: string }> };

// `ipAddress`/`userAgent` nunca vêm do body do client — são lidos direto dos
// headers da própria requisição, para que a evidência de assinatura não
// possa ser forjada.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_MANAGE);
    const { id } = await params;

    const custody = await prisma.assetCustody.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!custody) throw new NotFoundError("Custódia não encontrada.");

    const body = await request.json();
    const input = custodySignatureInputSchema.parse(body);

    const document = await prisma.custodyDocument.findFirst({
      where: { id: input.documentId, companyId, custodyId: id },
      select: { id: true },
    });
    if (!document) throw new ValidationError("Documento inválido.");

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0]?.trim();

    const signature = await prisma.custodySignature.create({
      data: {
        companyId,
        custodyId: id,
        documentId: document.id,
        signerName: input.signerName,
        signerDocument: input.signerDocument,
        signatureImageUrl: input.signatureImageUrl,
        signatureData: input.signatureData,
        signedAt: new Date(),
        ipAddress,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });

    return NextResponse.json({ signature }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
