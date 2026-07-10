import type { Prisma } from "@/app/generated/prisma/client";
import { ValidationError } from "@/lib/api-errors";
import { SYSTEM_ROLES } from "@/lib/permissions";

/**
 * Impede que a empresa fique sem nenhum ADMIN. Vale para 3 ações que têm o
 * mesmo efeito prático de "a empresa perde o último administrador":
 * excluir, bloquear (`active: false`) e trocar o papel do usuário para algo
 * diferente de ADMIN. Chamada sempre dentro da mesma transação da operação,
 * antes de aplicá-la.
 */
export async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  companyId: string,
  targetUserId: string,
) {
  const targetIsAdmin = await tx.userRole.findFirst({
    where: { companyId, userId: targetUserId, role: { name: SYSTEM_ROLES.ADMIN } },
    select: { id: true },
  });
  if (!targetIsAdmin) return;

  const adminCount = await tx.userRole.count({
    where: { companyId, role: { name: SYSTEM_ROLES.ADMIN } },
  });
  if (adminCount <= 1) {
    throw new ValidationError("Não é possível remover, bloquear ou trocar o papel do último administrador da empresa.");
  }
}
