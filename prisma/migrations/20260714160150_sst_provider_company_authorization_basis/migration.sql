-- Sprint Comercial SST 1.4 (extensão) — distingue COMO um vínculo passou a
-- existir/ficar ACTIVE: aprovação real da empresa (COMPANY_APPROVAL) vs.
-- acesso provisório concedido porque a consultoria criou o primeiro
-- pré-cadastro (PROVIDER_PRE_REGISTRATION) vs. futura ação de Super Admin
-- (SUPER_ADMIN, não implementada ainda).
--
-- Backfill de linhas existentes: o DEFAULT 'COMPANY_APPROVAL' abaixo já
-- cobre isso — confirmado antes de aplicar que nenhuma linha existente em
-- dev/produção foi criada pelo fluxo de pré-cadastro (nenhuma Company com
-- origin=SST_PROVIDER existe ainda), então não há necessidade de um UPDATE
-- adicional para reclassificar nenhuma linha como PROVIDER_PRE_REGISTRATION.

-- CreateEnum
CREATE TYPE "SstProviderAuthorizationBasis" AS ENUM ('COMPANY_APPROVAL', 'PROVIDER_PRE_REGISTRATION', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "SstProviderCompany"
  ADD COLUMN "authorizationBasis" "SstProviderAuthorizationBasis" NOT NULL DEFAULT 'COMPANY_APPROVAL',
  ADD COLUMN "companyReviewedAt" TIMESTAMP(3),
  ADD COLUMN "companyReviewedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "SstProviderCompany" ADD CONSTRAINT "SstProviderCompany_companyReviewedByUserId_fkey" FOREIGN KEY ("companyReviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
