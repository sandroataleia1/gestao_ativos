import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { updateProviderLinkStatus } from "@/lib/sst-providers";
import { SST_PROVIDER_ACCESS_LEVEL_VALUES } from "@/lib/validations/sst-provider";

const approveSchema = z.object({
  accessLevel: z.enum(SST_PROVIDER_ACCESS_LEVEL_VALUES).optional(),
});

type RouteParams = { params: Promise<{ relationshipId: string }> };

// Sprint Comercial SST 1.4, §15 — aprova uma solicitação PENDING (contrato
// dedicado, além do PATCH genérico já existente em
// /api/sst-providers/[id]). A empresa escolhe o nível de acesso aqui; se
// omitido, mantém o nível pedido pela consultoria. `companyId` sempre vem
// da sessão (`requirePermission`) — `relationshipId` é revalidado contra
// ela dentro de `updateProviderLinkStatus` (ownership check).
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { relationshipId } = await params;

    const body = await request.json().catch(() => ({}));
    const input = approveSchema.parse(body);

    const link = await updateProviderLinkStatus(companyId, { id: user.id, name: user.name }, relationshipId, {
      status: "ACTIVE",
      accessLevel: input.accessLevel,
    });

    return NextResponse.json({ providerLink: link });
  } catch (error) {
    return handleApiError(error);
  }
}
