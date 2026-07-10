import { NextResponse } from "next/server";

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS, SYSTEM_ROLES } from "@/lib/permissions";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit, type AuditAction } from "@/lib/audit";
import { assertNotLastAdmin } from "@/lib/user-admin";
import { updateUserProfileInputSchema } from "@/lib/validations/user-admin";

type RouteParams = { params: Promise<{ id: string }> };

// Atualização parcial: nome, papel e/ou status (bloquear/desbloquear) — os
// três podem vir juntos ou separados na mesma requisição, mas a UI só
// dispara um de cada vez hoje (ver users-panel.tsx).
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const { id } = await params;
    const body = updateUserProfileInputSchema.parse(await request.json());

    const target = await prisma.user.findFirst({ where: { id, companyId } });
    if (!target) throw new NotFoundError("Usuário não encontrado.");

    let newRole: { id: string; name: string } | null = null;
    if (body.roleId) {
      newRole = await prisma.role.findFirst({
        where: { id: body.roleId, companyId },
        select: { id: true, name: true },
      });
      if (!newRole) throw new ValidationError("Papel inválido.");
    }

    const willBlock = body.active === false;
    const willDemoteFromAdmin = Boolean(newRole && newRole.name !== SYSTEM_ROLES.ADMIN);

    const updated = await prisma.$transaction(async (tx) => {
      if (willBlock || willDemoteFromAdmin) {
        await assertNotLastAdmin(tx, companyId, id);
      }

      const dataToUpdate: Prisma.UserUpdateInput = {};
      if (body.name !== undefined) dataToUpdate.name = body.name;
      if (body.active !== undefined) dataToUpdate.active = body.active;

      const user = Object.keys(dataToUpdate).length
        ? await tx.user.update({ where: { id }, data: dataToUpdate })
        : target;

      if (newRole) {
        await tx.userRole.deleteMany({ where: { userId: id, companyId } });
        await tx.userRole.create({ data: { userId: id, companyId, roleId: newRole.id } });
      }

      const action: AuditAction =
        body.active !== undefined ? (body.active ? "user.unblock" : "user.block") : "user.update_profile";
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action,
        targetType: "User",
        targetId: id,
        targetLabel: `${target.name} <${target.email}>`,
        metadata: { name: body.name, active: body.active, role: newRole?.name },
      });

      return user;
    });

    return NextResponse.json({ id: updated.id, name: updated.name, active: updated.active });
  } catch (error) {
    return handleApiError(error);
  }
}

// Exclusão definitiva (não soft-delete — "bloquear" já cobre suspensão
// reversível). Cascata do schema já cuida de Session/Account/UserRole
// (onDelete: Cascade); o log de auditoria é gravado antes de apagar, na
// mesma transação, preservando nome/email do usuário excluído mesmo depois.
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const { id } = await params;

    if (id === actor.id) {
      throw new ValidationError("Você não pode excluir sua própria conta por aqui.");
    }

    const target = await prisma.user.findFirst({ where: { id, companyId } });
    if (!target) throw new NotFoundError("Usuário não encontrado.");

    await prisma.$transaction(async (tx) => {
      await assertNotLastAdmin(tx, companyId, id);
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "user.delete",
        targetType: "User",
        targetId: id,
        targetLabel: `${target.name} <${target.email}>`,
      });
      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
