import { NextResponse, type NextRequest } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import { handleApiError, ConflictError, NotFoundError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { deactivateTeamMember } from "@/lib/sst-team";
import { logInfo, logWarn } from "@/lib/logger";

type RouteParams = { params: Promise<{ memberId: string }> };

// POST /api/sst/team/[memberId]/deactivate — só OWNER. `active = false`
// (nunca hard delete). A próxima requisição autenticada desse usuário já é
// bloqueada por requireSstAuth() (filtra `active: true` a cada chamada, sem
// cache entre requisições) — efeito imediato mesmo com sessão Better Auth
// ainda válida, sem precisar revogar a sessão.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    const ctx = await requireSstRole("OWNER");
    const { memberId } = await params;

    const result = await deactivateTeamMember(ctx.providerId, memberId);

    if (result === "NOT_FOUND") {
      throw new NotFoundError("Membro da equipe não encontrado.");
    }
    if (result === "LAST_OWNER_PROTECTED") {
      logWarn("sst_team_deactivate_blocked_last_owner", { providerId: ctx.providerId, memberId });
      throw new ConflictError("A consultoria precisa de pelo menos um OWNER ativo.");
    }

    if (result === "DEACTIVATED") {
      logInfo("sst_team_member_deactivated", { providerId: ctx.providerId, actorUserId: ctx.user.id, memberId });
    }

    return NextResponse.json({ memberId, active: false });
  } catch (error) {
    return handleApiError(error);
  }
}
