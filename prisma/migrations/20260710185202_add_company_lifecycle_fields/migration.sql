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
