import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { updateProviderLinkStatus } from "@/lib/sst-providers";

type RouteParams = { params: Promise<{ relationshipId: string }> };

// Sprint Comercial SST 1.4, §15 — recusa uma solicitação PENDING (contrato
// dedicado). Usa o estado REJECTED (nunca REVOKED — uma solicitação nunca
// aprovada não é a mesma coisa que um acesso revogado, ver §15 do spec
// original e lib/sst-providers.ts).
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { relationshipId } = await params;

    const link = await updateProviderLinkStatus(companyId, { id: user.id, name: user.name }, relationshipId, {
      status: "REJECTED",
    });

    return NextResponse.json({ providerLink: link });
  } catch (error) {
    return handleApiError(error);
  }
}
