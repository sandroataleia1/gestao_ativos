-- ============================================================================
-- PROPOSTA de Migration M2A — NÃO APLICADA.
--
-- Gerada por `prisma migrate diff` (read-only) e conferida contra o banco de
-- desenvolvimento pós-M1 (localhost:5433/gestao_ativos): diff idêntico, sem
-- drift.
--
-- Exclusivamente ADITIVA:
--   * 1 enum novo (CompanyMembershipStatus);
--   * 1 tabela nova (CompanyMembership), companyId/userId NOT NULL mas SEM
--     nenhuma linha inicial (tabela nasce vazia — o backfill M2B é quem
--     popula, em script separado, versionado e revisável);
--   * unique (userId, companyId) — impede duplicidade de membership por par;
--   * 2 índices não-únicos (companyId+status, userId+status) + 1 índice em
--     invitedByUserId;
--   * 3 FKs: userId (CASCADE), companyId (RESTRICT), invitedByUserId (SET NULL).
--
-- NÃO cria FK entre UserRole e CompanyMembership (decisão do ADR-001, §3).
-- NÃO altera User.companyId, NÃO altera UserRole, NÃO altera requireCompany(),
-- NÃO muda comportamento de rota, NÃO popula dados (isso é o M2B, script
-- separado).
--
-- Para aplicar (SOMENTE após aprovação), copie o conteúdo para uma migration
-- real: `prisma/migrations/<timestamp>_add_company_memberships/migration.sql`
-- e rode `npx prisma migrate dev` (dev) — nunca em produção nesta sprint.
-- ============================================================================

-- CreateEnum
CREATE TYPE "CompanyMembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CompanyMembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedByUserId" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyMembership_companyId_status_idx" ON "CompanyMembership"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyMembership_userId_status_idx" ON "CompanyMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "CompanyMembership_invitedByUserId_idx" ON "CompanyMembership"("invitedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_userId_companyId_key" ON "CompanyMembership"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
