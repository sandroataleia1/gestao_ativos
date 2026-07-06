-- CreateEnum
CREATE TYPE "CertificationType" AS ENUM ('CA', 'INMETRO', 'ANATEL', 'ISO', 'OUTROS');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('VALID', 'EXPIRED', 'SUSPENDED', 'CANCELLED', 'PENDING');

-- CreateTable
CREATE TABLE "AssetCertification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "certificationType" "CertificationType" NOT NULL,
    "certificationNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "status" "CertificationStatus" NOT NULL DEFAULT 'VALID',
    "issuer" TEXT,
    "documentUrl" TEXT,
    "externalId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetCertification_companyId_idx" ON "AssetCertification"("companyId");

-- CreateIndex
CREATE INDEX "AssetCertification_assetId_idx" ON "AssetCertification"("assetId");

-- CreateIndex
CREATE INDEX "AssetCertification_expirationDate_idx" ON "AssetCertification"("expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCertification_companyId_certificationType_certificatio_key" ON "AssetCertification"("companyId", "certificationType", "certificationNumber");

-- AddForeignKey
ALTER TABLE "AssetCertification" ADD CONSTRAINT "AssetCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCertification" ADD CONSTRAINT "AssetCertification_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
