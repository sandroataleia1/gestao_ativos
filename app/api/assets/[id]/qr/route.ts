import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getOrCreateAssetQrToken } from "@/lib/qr-code";

type RouteParams = { params: Promise<{ id: string }> };

// Gerar QR Code é uma ação de gestão (exige asset:manage) — mesmo padrão de
// qualquer outra escrita neste app: nunca aceita companyId do client, sempre
// deriva da sessão.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.ASSET_MANAGE);
    const { id } = await params;

    const token = await getOrCreateAssetQrToken(companyId, id);

    return NextResponse.json({ token, url: `/q/${token}` });
  } catch (error) {
    return handleApiError(error);
  }
}
