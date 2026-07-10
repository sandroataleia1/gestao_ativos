import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { signUpEmailInternal, generatePasswordResetLink, withoutSessionCookieSideEffects } from "@/lib/auth";
import { handleApiError, ConflictError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { inviteUserInputSchema } from "@/lib/validations/user-admin";

// Convida um usuário: cria a conta com uma senha-placeholder aleatória que
// nunca é usada/exibida, e devolve um link de definição de senha (mesmo
// endpoint oficial de reset do Better Auth — ver `generatePasswordResetLink`
// em lib/auth.ts) para o admin compartilhar manualmente (não há serviço de
// e-mail configurado neste projeto).
export async function POST(request: Request) {
  try {
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const body = inviteUserInputSchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const role = await prisma.role.findFirst({ where: { id: body.roleId, companyId } });
    if (!role) throw new ValidationError("Papel inválido.");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictError("Já existe uma conta com este email.");

    const placeholderPassword = randomBytes(32).toString("base64url");
    // Preserva a sessão do admin — mesmo motivo de
    // app/api/company/users/route.ts (ver withoutSessionCookieSideEffects
    // em lib/auth.ts).
    const result = await withoutSessionCookieSideEffects(() =>
      signUpEmailInternal(
        { name: body.name, email, password: placeholderPassword, companyId },
        request.headers,
      ),
    );
    const newUserId = result.user.id;

    await prisma.$transaction(async (tx) => {
      await tx.userRole.create({ data: { userId: newUserId, companyId, roleId: role.id } });
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "user.invite",
        targetType: "User",
        targetId: newUserId,
        targetLabel: `${body.name} <${email}>`,
        metadata: { role: role.name },
      });
    });

    const resetLink = await generatePasswordResetLink(email);

    return NextResponse.json({
      id: newUserId,
      name: body.name,
      email,
      active: true,
      role: { id: role.id, name: role.name },
      resetLink,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
