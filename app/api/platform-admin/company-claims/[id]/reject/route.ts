import { NextResponse } from "next/server";

import { requirePlatformRole } from "@/lib/platform-auth";
import { rejectCompanyClaimRequestAsPlatformAdmin } from "@/lib/platform-admin-claims";
import { platformAdminDecisionSchema } from "@/lib/validations/platform-admin";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4D, §13 — rejeição pelo Super Admin. Mesmo contrato de body
// da aprovação (reviewNote obrigatória). Nunca duplica lógica — chama
// rejectCompanyClaimRequestAsPlatformAdmin.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const { id } = await params;

    const body = await request.json();
    const input = platformAdminDecisionSchema.parse(body);

    const result = await rejectCompanyClaimRequestAsPlatformAdmin({
      claimRequestId: id,
      reviewer: { id: user.id, name: user.name },
      reviewNote: input.reviewNote,
      verificationMethod: input.verificationMethod,
    });

    return NextResponse.json({ ok: true, claimId: result.claimId });
  } catch (error) {
    return handleApiError(error);
  }
}
