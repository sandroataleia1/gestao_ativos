import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth-server";
import { cancelCompanyClaimRequest } from "@/lib/company-claim-request";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ claimRequestId: string }> };

// Sprint SST 1.4C, §10/§14 — cancelamento pelo próprio requerente. Exige só
// sessão (nunca requireCompany() — quem tem claim pendente não tem
// companyId resolvido). `claimRequestId` é sempre revalidado dentro de
// cancelCompanyClaimRequest contra `requesterUserId` da sessão — nunca
// aceita cancelar a solicitação de outro usuário (ownership check).
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { claimRequestId } = await params;

    const result = await cancelCompanyClaimRequest({
      claimRequestId,
      actor: { id: user.id, name: user.name },
    });

    return NextResponse.json({ ok: true, claimId: result.claimId });
  } catch (error) {
    return handleApiError(error);
  }
}
