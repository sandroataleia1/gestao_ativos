import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePlatformRole } from "@/lib/platform-auth";
import { startCompanyClaimReview } from "@/lib/platform-admin-claims";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ id: string }> };

// Sprint SST 1.4D, §10/§12 — inicia análise (PENDING -> UNDER_REVIEW). Body
// nunca aceita companyId/requesterUserId/reviewedByUserId/controlStatus —
// só um reviewNote opcional (nota de contexto, não obrigatória para só
// "pegar" a claim, diferente de aprovar/rejeitar).
const startReviewSchema = z.object({
  reviewNote: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { user } = await requirePlatformRole("SUPER_ADMIN");
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const input = startReviewSchema.parse(body);

    const result = await startCompanyClaimReview({
      claimRequestId: id,
      reviewer: { id: user.id, name: user.name },
      reviewNote: input.reviewNote,
    });

    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return handleApiError(error);
  }
}
