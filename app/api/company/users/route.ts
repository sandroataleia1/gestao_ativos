import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { signUpEmailInternal, withoutSessionCookieSideEffects } from "@/lib/auth";
import { handleApiError, ConflictError, ValidationError } from "@/lib/api-errors";
import { logAudit } from "@/lib/audit";
import { createUserInputSchema } from "@/lib/validations/user-admin";

// Gestão de usuários da própria empresa — só ADMIN (USER_MANAGE é
// concedida só a ADMIN em DEFAULT_ROLE_PERMISSIONS, ver lib/permissions.ts).
export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const users = await prisma.user.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
        userRoles: {
          where: { companyId },
          select: { role: { select: { id: true, name: true } } },
        },
      },
    });

    const rows = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
      role: user.userRoles[0]?.role ?? null,
    }));

    return NextResponse.json(rows);
  } catch (error) {
    return handleApiError(error);
  }
}

// Cria um usuário direto — o admin escolhe a senha inicial na hora (ver
// POST /api/company/users/invite para o fluxo por link, sem senha
// escolhida pelo admin).
export async function POST(request: Request) {
  try {
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);
    const body = createUserInputSchema.parse(await request.json());
    const email = body.email.toLowerCase();

    const role = await prisma.role.findFirst({ where: { id: body.roleId, companyId } });
    if (!role) throw new ValidationError("Papel inválido.");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictError("Já existe uma conta com este email.");

    // Preserva a sessão do admin — sem isso, o Set-Cookie do usuário
    // recém-criado desconectaria quem está criando (ver
    // withoutSessionCookieSideEffects em lib/auth.ts).
    const result = await withoutSessionCookieSideEffects(() =>
      signUpEmailInternal({ name: body.name, email, password: body.password, companyId }, request.headers),
    );
    const newUserId = result.user.id;

    await prisma.$transaction(async (tx) => {
      await tx.userRole.create({ data: { userId: newUserId, companyId, roleId: role.id } });
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        action: "user.create",
        targetType: "User",
        targetId: newUserId,
        targetLabel: `${body.name} <${email}>`,
        metadata: { role: role.name },
      });
    });

    return NextResponse.json({
      id: newUserId,
      name: body.name,
      email,
      active: true,
      role: { id: role.id, name: role.name },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
