import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireAuth } from "@/lib/auth-server";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { logAudit } from "@/lib/audit";

type RouteParams = { params: Promise<{ membershipId: string }> };

// POST /api/company-memberships/[membershipId]/accept — Sprint 0.6, Parte G.
//
// Só o próprio usuário convidado pode aceitar o próprio convite — nunca
// aceita convite de outro usuário (a busca já filtra por `userId` da sessão,
// então um `membershipId` de outra pessoa simplesmente não é encontrado,
// devolvendo 404 sem revelar se o id existe).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // 1: exige só sessão global — nunca requireCompany() (o usuário pode
    // ainda não ter nenhuma empresa resolvida, ou estar numa empresa
    // diferente da do convite).
    const user = await requireAuth();
    const { membershipId } = await params;

    // 2: busca pelo id da membership E pelo userId da sessão juntos.
    const membership = await prisma.companyMembership.findFirst({
      where: { id: membershipId, userId: user.id },
      select: { id: true, companyId: true, status: true },
    });
    if (!membership) {
      throw new NotFoundError("Convite não encontrado.");
    }

    // 3: só aceita convites pendentes.
    if (membership.status !== "INVITED") {
      throw new ValidationError("Este convite não está mais pendente.");
    }

    // 4: a empresa precisa estar disponível.
    const company = await prisma.company.findUnique({
      where: { id: membership.companyId },
      select: { active: true, operationalStatus: true },
    });
    if (!company || !company.active || company.operationalStatus !== "ACTIVE") {
      throw new ValidationError("Esta empresa não está disponível no momento.");
    }

    // 5: precisa existir um papel já atribuído nesta empresa (criado junto
    // com o convite, em app/api/company-memberships/invite/route.ts) —
    // aceitar sem papel algum deixaria uma membership ACTIVE sem nenhuma
    // permissão utilizável, um estado que não deveria existir.
    const role = await prisma.userRole.findFirst({
      where: { userId: user.id, companyId: membership.companyId },
      select: { id: true },
    });
    if (!role) {
      throw new ValidationError("Convite sem papel associado — contate um administrador da empresa.");
    }

    // 6: transação — ACTIVE + activatedAt, limpando datas incompatíveis.
    await prisma.$transaction(async (tx) => {
      await tx.companyMembership.update({
        where: { id: membership.id },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          suspendedAt: null,
          revokedAt: null,
        },
      });

      // 7: auditoria na empresa aceita.
      await logAudit(tx, {
        companyId: membership.companyId,
        actorUserId: user.id,
        actorName: user.name,
        action: "user.invite",
        targetType: "CompanyMembership",
        targetId: membership.id,
        metadata: { event: "accepted" },
      });
    });

    // 8/9: User.companyId nunca é tocado; nenhuma seleção automática de
    // contexto acontece aqui — a UI chama POST /api/company-context à parte
    // se quiser entrar na empresa imediatamente após aceitar.
    return NextResponse.json({ companyId: membership.companyId, status: "ACTIVE" });
  } catch (error) {
    return handleApiError(error);
  }
}
