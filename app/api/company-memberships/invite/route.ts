import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { ForbiddenError, requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError, ValidationError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { logAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { inviteCompanyMembershipSchema } from "@/lib/validations/company-membership";

// POST /api/company-memberships/invite — Sprint 0.6, Parte F.
//
// Convida um usuário GLOBAL EXISTENTE (nunca cria conta nova) para uma
// segunda `CompanyMembership` na empresa do ator. A resposta é sempre
// genérica (200), independente de o e-mail ter conta, já ter membership, ou
// qualquer outro estado — nunca revela nada sobre a existência da conta-alvo
// (Sprint 0.6, Parte F: "Privacidade da resposta").
const GENERIC_RESPONSE = {
  message: "Caso exista uma conta elegível para esse endereço, o convite ficará disponível ao usuário.",
};

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // 1/2: exige membership ACTIVE do ator (via requireCompany() dentro de
    // requirePermission()) + permissão de gestão de usuários — a empresa
    // usada em TODO o resto desta rota é sempre a resolvida aqui, nunca o
    // body (item 6: "impedir convite para outra empresa via parâmetros
    // manipulados"). Como este é o `requirePermission()` do Portal Empresa
    // (CompanyMembership + UserRole), um `SstProviderUser` nunca substitui
    // essa checagem (item 7).
    const { user: actor, companyId } = await requirePermission(PERMISSIONS.USER_MANAGE);

    const rawBody = await request.json();
    // 3: normaliza o e-mail (trim + lowercase) ANTES da validação de formato.
    const normalizedBody = {
      ...rawBody,
      email: typeof rawBody?.email === "string" ? rawBody.email.trim().toLowerCase() : rawBody?.email,
    };
    const input = inviteCompanyMembershipSchema.parse(normalizedBody);

    // 4/5: roleId precisa pertencer à empresa resolvida — nunca aceita um
    // papel de outra empresa, mesmo que o id seja válido em outro tenant.
    const role = await prisma.role.findFirst({
      where: { id: input.roleId, companyId },
      select: { id: true },
    });
    if (!role) {
      throw new ValidationError("Papel inválido.");
    }

    const targetUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    // E-mail sem conta elegível — nunca revelado; nenhuma escrita acontece.
    if (!targetUser) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const existingMembership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: targetUser.id, companyId } },
    });

    if (!existingMembership) {
      // Papéis residuais: um UserRole nesta empresa sem NENHUMA membership
      // correspondente é uma inconsistência de integridade — nunca silenciada,
      // nunca corrigida automaticamente aqui (Sprint 0.6, Parte F, "Papéis
      // residuais"). Bloqueia o convite e só registra o conflito internamente.
      const orphanRole = await prisma.userRole.findFirst({
        where: { userId: targetUser.id, companyId },
        select: { id: true },
      });
      if (orphanRole) {
        logger.warn(
          { actorUserId: actor.id, companyId, targetUserId: targetUser.id, userRoleId: orphanRole.id },
          "company_membership_invite_blocked_orphan_userrole",
        );
        return NextResponse.json(GENERIC_RESPONSE);
      }

      // 9: criação da membership + atribuição do papel em transação.
      await prisma.$transaction(async (tx) => {
        const membership = await tx.companyMembership.create({
          data: {
            userId: targetUser.id,
            companyId,
            status: "INVITED",
            invitedByUserId: actor.id,
            activatedAt: null,
          },
        });
        await tx.userRole.create({
          data: { userId: targetUser.id, companyId, roleId: role.id },
        });
        // 10: auditoria sem e-mail — só ids opacos.
        await logAudit(tx, {
          companyId,
          actorUserId: actor.id,
          actorName: actor.name,
          action: "user.invite",
          targetType: "CompanyMembership",
          targetId: membership.id,
        });
      });

      return NextResponse.json(GENERIC_RESPONSE);
    }

    if (existingMembership.status === "INVITED") {
      // Idempotente — não duplica membership nem papel.
      return NextResponse.json(GENERIC_RESPONSE);
    }

    if (existingMembership.status === "ACTIVE") {
      // Não altera acesso já concedido; resposta externa continua genérica.
      return NextResponse.json(GENERIC_RESPONSE);
    }

    // SUSPENDED ou REVOKED — nunca reativa silenciosamente; exige fluxo
    // administrativo explícito futuro (não implementado nesta sprint).
    logger.warn(
      { actorUserId: actor.id, companyId, targetUserId: targetUser.id, membershipStatus: existingMembership.status },
      "company_membership_invite_blocked_inactive_membership",
    );
    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    return handleApiError(error);
  }
}
