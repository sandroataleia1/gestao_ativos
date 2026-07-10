import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { generatePasswordResetLink } from "@/lib/auth";
import { handleApiError, NotFoundError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

// Gera um link de redefinição de senha para um usuário já existente (mesmo
// mecanismo do convite — ver lib/auth.ts `generatePasswordResetLink`). O
// admin compartilha o link manualmente; a senha atual do usuário continua
// válida até que ele efetivamente abra o link e defina uma nova.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const { id } = await params;

    const target = await prisma.user.findFirst({ where: { id, companyId } });
    if (!target) throw new NotFoundError("Usuário não encontrado.");

    const resetLink = await generatePasswordResetLink(target.email);

    await prisma.$transaction(async (tx) => {
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "user.password_reset_link",
        targetType: "User",
        targetId: id,
        targetLabel: `${target.name} <${target.email}>`,
      });
    });

    return NextResponse.json({ resetLink });
  } catch (error) {
    return handleApiError(error);
  }
}
