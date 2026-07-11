import { NextResponse, type NextRequest } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import { handleApiError, ConflictError, NotFoundError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { changeTeamMemberRole } from "@/lib/sst-team";
import { changeTeamMemberRoleSchema } from "@/lib/validations/sst-team";
import { logInfo, logWarn } from "@/lib/logger";

type RouteParams = { params: Promise<{ memberId: string }> };

// PATCH /api/sst/team/[memberId] — troca de papel. Só OWNER.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    const ctx = await requireSstRole("OWNER");
    const { memberId } = await params;

    const body = await request.json();
    const input = changeTeamMemberRoleSchema.parse(body);

    const result = await changeTeamMemberRole(ctx.providerId, memberId, input.role);

    if (result === "NOT_FOUND") {
      throw new NotFoundError("Membro da equipe não encontrado.");
    }
    if (result === "LAST_OWNER_PROTECTED") {
      logWarn("sst_team_role_change_blocked_last_owner", { providerId: ctx.providerId, memberId });
      throw new ConflictError("A consultoria precisa de pelo menos um OWNER ativo.");
    }

    logInfo("sst_team_role_changed", { providerId: ctx.providerId, actorUserId: ctx.user.id, memberId, role: input.role });
    return NextResponse.json({ memberId, role: input.role });
  } catch (error) {
    return handleApiError(error);
  }
}
