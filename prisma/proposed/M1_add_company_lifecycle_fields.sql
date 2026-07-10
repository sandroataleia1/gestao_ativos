-- ============================================================================
-- PROPOSTA de Migration M1 — NÃO APLICADA.
-- (Revisão 2 — corrigida após aprovação parcial da Sprint 0.2.)
--
-- Gerada por `prisma migrate diff` (read-only) e conferida contra o banco de
-- desenvolvimento (localhost:5433/gestao_ativos): diff idêntico, sem drift.
--
-- Exclusivamente ADITIVA:
--   * 4 enums novos (CompanyOperationalStatus, CompanyControlStatus,
--     CompanyOrigin, CompanyDocumentType);
--   * 8 colunas novas em "Company", todas opcionais ou com DEFAULT (empresas
--     atuais ficam ACTIVE / CLAIMED / SELF_REGISTRATION automaticamente pelo
--     NOT NULL DEFAULT; claimedAt/documentType/documentOriginal/
--     documentNormalized ficam NULL — sem backfill);
--   * FK "createdByProviderId" com ON DELETE RESTRICT (ver README.md: não há
--     hard delete de SstProvider no repositório; o prestador é sempre
--     desativado logicamente via SstProvider.active = false).
--
-- NÃO toca no campo legado "document" (Company.document permanece igual).
-- NÃO cria CompanyMembership, NÃO altera User.companyId, NÃO altera
-- requireCompany(), NÃO muda comportamento de rota, NÃO cria índice único,
-- NÃO normaliza/corrige nenhum CNPJ existente.
--
-- Para aplicar (SOMENTE após aprovação), copie o conteúdo para uma migration
-- real: `prisma/migrations/<timestamp>_add_company_lifecycle_fields/migration.sql`
-- e rode `npx prisma migrate deploy` (ou `migrate dev`).
-- ============================================================================

-- CreateEnum
CREATE TYPE "CompanyOperationalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CompanyControlStatus" AS ENUM ('UNCLAIMED', 'CLAIM_PENDING', 'CLAIMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CompanyOrigin" AS ENUM ('SELF_REGISTRATION', 'SST_PROVIDER', 'SUPER_ADMIN', 'IMPORT');

-- CreateEnum
CREATE TYPE "CompanyDocumentType" AS ENUM ('CNPJ', 'FOREIGN_REGISTRATION');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "controlStatus" "CompanyControlStatus" NOT NULL DEFAULT 'CLAIMED',
ADD COLUMN     "createdByProviderId" TEXT,
ADD COLUMN     "documentNormalized" TEXT,
ADD COLUMN     "documentOriginal" TEXT,
ADD COLUMN     "documentType" "CompanyDocumentType",
ADD COLUMN     "operationalStatus" "CompanyOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "origin" "CompanyOrigin" NOT NULL DEFAULT 'SELF_REGISTRATION';

-- CreateIndex
CREATE INDEX "Company_createdByProviderId_idx" ON "Company"("createdByProviderId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdByProviderId_fkey" FOREIGN KEY ("createdByProviderId") REFERENCES "SstProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
