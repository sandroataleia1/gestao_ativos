-- CreateEnum
CREATE TYPE "CustodyDocumentType" AS ENUM ('DELIVERY_TERM', 'RETURN_TERM');

-- CreateTable
CREATE TABLE "CustodyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "type" "CustodyDocumentType" NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodySignature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerDocument" TEXT NOT NULL,
    "signatureImageUrl" TEXT,
    "signatureData" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodySignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustodyDocument_companyId_idx" ON "CustodyDocument"("companyId");

-- CreateIndex
CREATE INDEX "CustodyDocument_custodyId_idx" ON "CustodyDocument"("custodyId");

-- CreateIndex
CREATE INDEX "CustodySignature_companyId_idx" ON "CustodySignature"("companyId");

-- CreateIndex
CREATE INDEX "CustodySignature_custodyId_idx" ON "CustodySignature"("custodyId");

-- CreateIndex
CREATE INDEX "CustodySignature_documentId_idx" ON "CustodySignature"("documentId");

-- AddForeignKey
ALTER TABLE "CustodyDocument" ADD CONSTRAINT "CustodyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyDocument" ADD CONSTRAINT "CustodyDocument_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "AssetCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodySignature" ADD CONSTRAINT "CustodySignature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodySignature" ADD CONSTRAINT "CustodySignature_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "AssetCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodySignature" ADD CONSTRAINT "CustodySignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CustodyDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
