import { NextResponse, type NextRequest } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { reactivateTeamMember } from "@/lib/sst-team";
import { logInfo } from "@/lib/logger";

type RouteParams = { params: Promise<{ memberId: string }> };

// POST /api/sst/team/[memberId]/reactivate — só OWNER. Reversão explícita
// da desativação (nenhum estado de "convite" envolvido — ver lib/sst-team.ts).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    const ctx = await requireSstRole("OWNER");
    const { memberId } = await params;

    const result = await reactivateTeamMember(ctx.providerId, memberId);

    if (result === "NOT_FOUND") {
      throw new NotFoundError("Membro da equipe não encontrado.");
    }

    if (result === "REACTIVATED") {
      logInfo("sst_team_member_reactivated", { providerId: ctx.providerId, actorUserId: ctx.user.id, memberId });
    }

    return NextResponse.json({ memberId, active: true });
  } catch (error) {
    return handleApiError(error);
  }
}
