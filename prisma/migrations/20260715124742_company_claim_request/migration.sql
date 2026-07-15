-- CreateEnum
CREATE TYPE "CompanyClaimRequestStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CompanyClaimRequestOrigin" AS ENUM ('SELF_REGISTRATION', 'EXISTING_PRE_REGISTRATION');

-- CreateTable
CREATE TABLE "CompanyClaimRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "status" "CompanyClaimRequestStatus" NOT NULL DEFAULT 'PENDING',
    "origin" "CompanyClaimRequestOrigin" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyClaimRequest_companyId_status_requestedAt_idx" ON "CompanyClaimRequest"("companyId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "CompanyClaimRequest_requesterUserId_status_idx" ON "CompanyClaimRequest"("requesterUserId", "status");

-- CreateIndex
CREATE INDEX "CompanyClaimRequest_status_requestedAt_idx" ON "CompanyClaimRequest"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaimRequest_companyId_requesterUserId_key" ON "CompanyClaimRequest"("companyId", "requesterUserId");

-- AddForeignKey
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "CompanyClaimRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "CompanyClaimRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimRequest" ADD CONSTRAINT "CompanyClaimRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
