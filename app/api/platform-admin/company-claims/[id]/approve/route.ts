import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { approveCompanyClaimRequestAsPlatformAdmin } from "@/lib/platform-admin-claims";
import { platformAdminDecisionSchema } from "@/lib/validations/platform-admin";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4D, §12 — aprovação pelo Super Admin. Nunca duplica a
// lógica de aprovação (chama approveCompanyClaimRequestAsPlatformAdmin,
// que por sua vez chama o serviço já testado desde a Sprint SST 1.4C).
// Body só aceita reviewNote (obrigatória)/verificationMethod (opcional) —
// o schema Zod nunca reconhece companyId/requesterUserId/roleId/
// membershipStatus/controlStatus/reviewedByUserId/PlatformUserRole/
// accessLevel/authorizationBasis, então mesmo que o client mande esses
// campos eles nunca chegam ao serviço.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const { id } = await params;

    const body = await request.json();
    const input = platformAdminDecisionSchema.parse(body);

    const result = await approveCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: id,
      reviewer: { id: user.id, name: user.name },
      reviewNote: input.reviewNote,
      verificationMethod: input.verificationMethod,
    });

    return NextResponse.json({ ok: true, claimId: result.claimId, controlStatus: result.controlStatus });
  } catch (error) {
    return handleApiError(error);
  }
}
