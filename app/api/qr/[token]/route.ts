import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-errors";
import { computeQrPermissions, resolveQrToken } from "@/lib/qr-code";

type RouteParams = { params: Promise<{ token: string }> };

// Rota pública: não exige sessão (requisito 5 — "página pública/controlada").
// Nunca aceita nem devolve o `id` interno como chave de busca, só o token
// opaco. As permissões devolvidas (requisito 4) refletem a sessão atual, se
// houver — mas a ausência de sessão nunca impede a leitura básica, só a
// leitura de trechos sensíveis/gerenciamento (requisito 6).
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { token } = await params;
    const lookup = await resolveQrToken(token);
    if (!lookup) {
      return NextResponse.json({ error: "QR Code inválido ou não encontrado." }, { status: 404 });
    }

    const permissions = await computeQrPermissions(lookup);

    return NextResponse.json({
      type: lookup.type,
      company: { name: lookup.companyName },
      status: lookup.status,
      data: lookup.resource,
      permissions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
