import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoxesIcon } from "lucide-react";

import { computeQrPermissions, resolveQrToken } from "@/lib/qr-code";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCustodyDocuments } from "./qr-custody-documents";

export const metadata: Metadata = {
  title: "Consulta por QR Code — Gestão de Ativos",
};

const TYPE_LABEL = {
  ASSET: "Ativo",
  ASSET_UNIT: "Unidade patrimonial",
  CUSTODY: "Entrega / Custódia",
} as const;

const MANAGE_HREF = {
  ASSET: "/assets",
  ASSET_UNIT: "/stock",
  CUSTODY: "/custodies",
} as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

// Página pública/controlada (requisito 5): não exige sessão para o resumo
// básico. Cada seção sensível (colaborador da custódia, local atual da
// unidade, conteúdo do termo) só aparece quando `permissions.canView` é true
// — ou seja, quando quem está olhando está autenticado, na mesma empresa do
// recurso, e tem a permissão de visualização correspondente. Nenhuma escrita
// acontece nesta página (requisito 6): é só leitura, mesmo para quem tem
// `canManage` (esse caso só ganha um link para a tela de gestão de verdade,
// que já reforça auth/permissão por conta própria).
export default async function QrTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lookup = await resolveQrToken(token);
  if (!lookup) notFound();

  const permissions = await computeQrPermissions(lookup);
  const title = lookup.type === "ASSET" ? lookup.resource.name : lookup.resource.assetName;

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
              <Badge variant="outline">{TYPE_LABEL[lookup.type]}</Badge>
              <Badge>{lookup.status}</Badge>
            </div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <div className="flex items-center gap-2">
              {lookup.companyLogoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL local, não passa pelo otimizador de imagem do Next
                <img src={lookup.companyLogoDataUrl} alt="" className="size-5 shrink-0 rounded object-contain" />
              ) : null}
              <p className="text-sm text-muted-foreground">{lookup.companyName}</p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {lookup.type === "ASSET" ? (
              <dl className="grid gap-2">
                <Row label="Código" value={lookup.resource.assetCode} />
                <Row label="Categoria" value={lookup.resource.categoryName} />
                <Row label="Condição" value={lookup.resource.conditionName} />
              </dl>
            ) : null}

            {lookup.type === "ASSET_UNIT" ? (
              <dl className="grid gap-2">
                <Row label="Código do ativo" value={lookup.resource.assetCode} />
                <Row
                  label="Identificação"
                  value={lookup.resource.serialNumber ?? lookup.resource.patrimonyNumber ?? "—"}
                />
                <Row label="Condição" value={lookup.resource.conditionName} />
                {permissions.canView ? (
                  <Row label="Local atual" value={lookup.resource.currentLocationName ?? "—"} />
                ) : null}
              </dl>
            ) : null}

            {lookup.type === "CUSTODY" ? (
              <>
                <dl className="grid gap-2">
                  <Row label="Ativo" value={`${lookup.resource.assetName} (${lookup.resource.assetCode})`} />
                  <Row
                    label={lookup.resource.assetUnitId ? "Unidade" : "Quantidade"}
                    value={
                      lookup.resource.assetUnitId
                        ? (lookup.resource.unitLabel ?? "—")
                        : `${lookup.resource.quantity}${
                            lookup.resource.defaultUnit ? ` ${lookup.resource.defaultUnit}` : ""
                          }`
                    }
                  />
                  <Row label="Entregue em" value={formatDate(lookup.resource.deliveredAt)} />
                  {lookup.resource.returnedAt ? (
                    <Row label="Devolvido em" value={formatDate(lookup.resource.returnedAt)} />
                  ) : null}
                  {permissions.canView ? (
                    <Row label="Colaborador" value={lookup.resource.employeeName} />
                  ) : null}
                </dl>

                <QrCustodyDocuments
                  custodyId={lookup.resource.id}
                  documents={lookup.resource.documents}
                  canView={permissions.canView}
                />
              </>
            ) : null}

            {!permissions.sameCompany ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Faça login com uma conta desta empresa para ver mais detalhes.
              </p>
            ) : null}

            {permissions.canManage ? (
              <Link
                href={MANAGE_HREF[lookup.type]}
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                Gerenciar no sistema
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
