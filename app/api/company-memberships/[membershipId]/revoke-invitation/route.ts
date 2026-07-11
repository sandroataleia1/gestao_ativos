import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { ForbiddenError, requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { logAudit } from "@/lib/audit";

type RouteParams = { params: Promise<{ membershipId: string }> };

// POST /api/company-memberships/[membershipId]/revoke-invitation — Sprint
// 0.6, Parte H. Endpoint ADMINISTRATIVO: cancela um convite ainda pendente
// (status INVITED) — não implementa reativação de membership REVOKED (fora
// de escopo desta sprint).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // Gestão de usuários na empresa resolvida — a empresa nunca vem do
    // body/params, sempre do contexto (mesma disciplina das Partes F/G).
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const { membershipId } = await params;

    // Garante que a membership pertence à MESMA empresa resolvida — nunca
    // permite a um admin de uma empresa cancelar convite de outra só porque
    // adivinhou/enumerou um id.
    const membership = await prisma.companyMembership.findFirst({
      where: { id: membershipId, companyId },
      select: { id: true, userId: true, companyId: true, status: true },
    });
    if (!membership) {
      throw new NotFoundError("Convite não encontrado.");
    }

    if (membership.status !== "INVITED") {
      throw new ValidationError("Só é possível cancelar convites ainda pendentes.");
    }

    await prisma.$transaction(async (tx) => {
      // Preserva a linha da membership (histórico) — só muda o status.
      await tx.companyMembership.update({
        where: { id: membership.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });

      // Remove o(s) UserRole criado(s) para o convite — não deixa um papel
      // "solto" (sem membership ativa) para trás.
      await tx.userRole.deleteMany({
        where: { userId: membership.userId, companyId: membership.companyId },
      });

      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "user.invite",
        targetType: "CompanyMembership",
        targetId: membership.id,
        metadata: { event: "invitation_revoked" },
      });
    });

    return NextResponse.json({ membershipId: membership.id, status: "REVOKED" });
  } catch (error) {
    return handleApiError(error);
  }
}
