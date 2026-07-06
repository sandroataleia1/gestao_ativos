import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoxesIcon } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignRequestForm } from "./sign-request-form";

export const metadata: Metadata = {
  title: "Assinar termo de responsabilidade — Gestão de Ativos",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  DELIVERY_TERM: "Termo de entrega",
  RETURN_TERM: "Termo de devolução",
};

function formatDateTime(value: Date) {
  return value.toLocaleString("pt-BR");
}

// Página pública (sem sessão) — mesmo padrão estrutural de app/q/[token]:
// token opaco de uso único, enviado privadamente ao WhatsApp do colaborador
// que precisa assinar. Ver comentário no model CustodySignatureRequest para
// a diferença de modelo de confiança em relação ao token de QR Code.
export default async function SignRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const signatureRequest = await prisma.custodySignatureRequest.findUnique({
    where: { token },
    include: {
      document: { select: { contentHtml: true, type: true } },
      custody: {
        select: {
          employee: { select: { name: true } },
          asset: { select: { name: true } },
          company: { select: { name: true } },
        },
      },
    },
  });
  if (!signatureRequest) notFound();

  const isSigned = signatureRequest.status === "SIGNED";

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/30 p-6">
      <div className="w-full max-w-md pt-10">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-heading text-lg font-semibold"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BoxesIcon className="size-4" />
          </span>
          Gestão de Ativos
        </Link>

        <Card>
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                {DOCUMENT_TYPE_LABEL[signatureRequest.document.type] ?? signatureRequest.document.type}
              </Badge>
              <Badge>{isSigned ? "Assinado" : "Pendente de assinatura"}</Badge>
            </div>
            <CardTitle className="text-lg">{signatureRequest.custody.asset.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{signatureRequest.custody.company.name}</p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div
              className="max-h-80 overflow-y-auto rounded-lg border bg-card p-4 text-sm [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: signatureRequest.document.contentHtml }}
            />

            {isSigned ? (
              <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                Documento já assinado
                {signatureRequest.signedAt ? ` em ${formatDateTime(signatureRequest.signedAt)}` : ""}.
              </p>
            ) : (
              <SignRequestForm token={token} employeeName={signatureRequest.custody.employee.name} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
