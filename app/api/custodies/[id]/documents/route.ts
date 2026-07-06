import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { custodyDocumentInputSchema } from "@/lib/validations/custody-document";
import { buildCustodyTermHtml, custodyListInclude } from "@/lib/custodies";

type RouteParams = { params: Promise<{ id: string }> };

// Requisito 5: termo HTML com dados da empresa, colaborador, ativo,
// quantidade/unidade, data do evento e responsabilidades do colaborador.
// RETURN_TERM só pode ser gerado depois que a custódia foi de fato
// devolvida — não faz sentido emitir "termo de devolução" de algo que ainda
// está em posse do colaborador.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_MANAGE);
    const { id } = await params;

    const custody = await prisma.assetCustody.findFirst({
      where: { id, companyId },
      include: custodyListInclude,
    });
    if (!custody) throw new NotFoundError("Custódia não encontrada.");

    const body = await request.json();
    const input = custodyDocumentInputSchema.parse(body);

    if (input.type === "RETURN_TERM" && custody.status !== "RETURNED") {
      throw new ValidationError(
        "Só é possível gerar o termo de devolução depois que a custódia for devolvida.",
      );
    }

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, document: true },
    });

    const contentHtml = buildCustodyTermHtml(input.type, custody, company);

    const document = await prisma.custodyDocument.create({
      data: {
        companyId,
        custodyId: custody.id,
        type: input.type,
        contentHtml,
        generatedAt: new Date(),
      },
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_VIEW);
    const { id } = await params;

    const custody = await prisma.assetCustody.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!custody) throw new NotFoundError("Custódia não encontrada.");

    const documents = await prisma.custodyDocument.findMany({
      where: { companyId, custodyId: id },
      include: { signatures: { orderBy: { signedAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    return handleApiError(error);
  }
}
