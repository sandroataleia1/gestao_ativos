import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { resolveClaimDecision } from "@/lib/company-claim";
import { handleApiError } from "@/lib/api-errors";

const decisionSchema = z.object({
  decision: z.enum(["CONTINUE", "BLOCK"]),
  accessLevel: z.enum(["VIEW", "OPERATION", "ADMINISTRATION"]).optional(),
});

type RouteParams = { params: Promise<{ relationshipId: string }> };

// Decisão da empresa sobre UM vínculo provisório criado pelo pré-cadastro
// de uma consultoria (Sprint Comercial SST 1.4, §17/§18) — `companyId`
// sempre resolvido da sessão, nunca do body/URL. `relationshipId` é
// revalidado dentro de `resolveClaimDecision` contra a empresa da sessão e
// contra o estado esperado (ACTIVE + PROVIDER_PRE_REGISTRATION + ainda não
// revisado) — nunca aceita decidir sobre o vínculo de outra empresa.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { relationshipId } = await params;

    const body = await request.json();
    const input = decisionSchema.parse(body);

    const result = await resolveClaimDecision(
      companyId,
      { id: user.id, name: user.name },
      relationshipId,
      input.decision,
      input.accessLevel,
    );

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
