-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('PENDING', 'SENT', 'SIGNED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "whatsappApiKey" TEXT,
ADD COLUMN     "whatsappApiUrl" TEXT,
ADD COLUMN     "whatsappInstanceName" TEXT;

-- CreateTable
CREATE TABLE "CustodySignatureRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodySignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustodySignatureRequest_token_key" ON "CustodySignatureRequest"("token");

-- CreateIndex
CREATE INDEX "CustodySignatureRequest_companyId_idx" ON "CustodySignatureRequest"("companyId");

-- CreateIndex
CREATE INDEX "CustodySignatureRequest_custodyId_idx" ON "CustodySignatureRequest"("custodyId");

-- AddForeignKey
ALTER TABLE "CustodySignatureRequest" ADD CONSTRAINT "CustodySignatureRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodySignatureRequest" ADD CONSTRAINT "CustodySignatureRequest_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "AssetCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodySignatureRequest" ADD CONSTRAINT "CustodySignatureRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CustodyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
