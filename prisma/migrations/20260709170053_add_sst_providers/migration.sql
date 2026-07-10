-- CreateEnum
CREATE TYPE "TrainingManagementMode" AS ENUM ('INTERNAL', 'EXTERNAL_PROVIDER');

-- CreateEnum
CREATE TYPE "SstProviderCompanyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SstProviderCompanyAccessLevel" AS ENUM ('VIEW', 'OPERATION', 'ADMINISTRATION');

-- AlterTable
ALTER TABLE "CompanyTraining" ADD COLUMN     "managedByProviderId" TEXT,
ADD COLUMN     "managementMode" "TrainingManagementMode" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "SstProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SstProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SstProviderCompany" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "SstProviderCompanyStatus" NOT NULL DEFAULT 'PENDING',
    "accessLevel" "SstProviderCompanyAccessLevel" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SstProviderCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SstProviderCompany_companyId_idx" ON "SstProviderCompany"("companyId");

-- CreateIndex
CREATE INDEX "SstProviderCompany_providerId_idx" ON "SstProviderCompany"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "SstProviderCompany_providerId_companyId_key" ON "SstProviderCompany"("providerId", "companyId");

-- AddForeignKey
ALTER TABLE "CompanyTraining" ADD CONSTRAINT "CompanyTraining_managedByProviderId_fkey" FOREIGN KEY ("managedByProviderId") REFERENCES "SstProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SstProviderCompany" ADD CONSTRAINT "SstProviderCompany_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "SstProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SstProviderCompany" ADD CONSTRAINT "SstProviderCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SstProviderCompany" ADD CONSTRAINT "SstProviderCompany_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
