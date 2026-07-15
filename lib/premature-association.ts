// Sprint SST 1.4C.1, §6 — classificação PURA (sem Prisma/console) usada por
// scripts/diagnose-pending-claim-user-company.ts. Extraída para ser
// testável diretamente, sem precisar rodar o script inteiro contra um
// banco.

export type PrematureAssociationInput = {
  userCompanyId: string | null;
  claimCompanyIds: string[];
  activeMembershipCompanyIds: string[];
};

/**
 * Associação legada prematura: `User.companyId` aponta para uma empresa
 * que o usuário reivindicou, mas para a qual ele NÃO tem CompanyMembership
 * ACTIVE — sinal de que a coluna foi preenchida pelo fluxo antigo (Sprint
 * SST 1.4C, antes da correção 1.4C.1) sem que o usuário administre aquela
 * empresa de fato.
 */
export function isPrematureAssociation(input: PrematureAssociationInput): boolean {
  if (input.userCompanyId === null) return false;
  const claimedThisCompany = input.claimCompanyIds.includes(input.userCompanyId);
  if (!claimedThisCompany) return false;
  const hasActiveMembershipForIt = input.activeMembershipCompanyIds.includes(input.userCompanyId);
  return !hasActiveMembershipForIt;
}
