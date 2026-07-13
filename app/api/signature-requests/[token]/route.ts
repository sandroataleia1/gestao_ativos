import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { signatureRequestSignSchema } from "@/lib/validations/custody";

type RouteParams = { params: Promise<{ token: string }> };

const ALREADY_SIGNED_MESSAGE = "Este termo já foi assinado.";

function findSignatureRequest(token: string) {
  return prisma.custodySignatureRequest.findUnique({
    where: { token },
    include: {
      document: { select: { id: true, contentHtml: true, type: true, generatedAt: true } },
      custody: {
        select: {
          employee: { select: { name: true, document: true } },
          asset: { select: { name: true } },
          company: { select: { name: true } },
        },
      },
    },
  });
}

// Rota pública: token opaco de uso único enviado privadamente ao WhatsApp de
// um colaborador específico (não impresso/exposto como o QR — ver
// comentário no model CustodySignatureRequest), por isso expõe o
// `contentHtml` completo do termo sem exigir sessão.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { token } = await params;
    const signatureRequest = await findSignatureRequest(token);
    if (!signatureRequest) {
      return NextResponse.json({ error: "Link de assinatura inválido ou não encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      status: signatureRequest.status,
      signedAt: signatureRequest.signedAt,
      employeeName: signatureRequest.custody.employee.name,
      assetName: signatureRequest.custody.asset.name,
      companyName: signatureRequest.custody.company.name,
      document: {
        type: signatureRequest.document.type,
        contentHtml: signatureRequest.document.contentHtml,
        generatedAt: signatureRequest.document.generatedAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Também pública — quem assina aqui normalmente não tem conta no sistema.
// Nome/documento do assinante nunca vêm do body: são sempre lidos do
// colaborador da própria custódia (mesma decisão já tomada para a
// assinatura presencial em app/(app)/custodies/new/step-confirm.tsx).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { token } = await params;
    const body = await request.json();
    const input = signatureRequestSignSchema.parse(body);

    const signatureRequest = await findSignatureRequest(token);
    if (!signatureRequest) {
      throw new NotFoundError("Link de assinatura inválido ou não encontrado.");
    }
    if (signatureRequest.status === "SIGNED") {
      throw new ValidationError(ALREADY_SIGNED_MESSAGE);
    }

    const signedAt = new Date();
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = request.headers.get("user-agent") ?? undefined;

    await prisma.$transaction([
      prisma.custodySignature.create({
        data: {
          companyId: signatureRequest.companyId,
          custodyId: signatureRequest.custodyId,
          documentId: signatureRequest.documentId,
          signerName: signatureRequest.custody.employee.name,
          signerDocument: signatureRequest.custody.employee.document,
          signatureData: input.signatureData,
          signedAt,
          ipAddress,
          userAgent,
        },
      }),
      prisma.custodySignatureRequest.update({
        where: { token },
        data: { status: "SIGNED", signedAt },
      }),
    ]);

    return NextResponse.json({ ok: true, signedAt });
  } catch (error) {
    return handleApiError(error);
  }
}
