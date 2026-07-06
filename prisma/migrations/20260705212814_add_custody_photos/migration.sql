-- CreateEnum
CREATE TYPE "CustodyPhotoKind" AS ENUM ('DELIVERY', 'RETURN');

-- CreateTable
CREATE TABLE "CustodyPhoto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "custodyId" TEXT NOT NULL,
    "kind" "CustodyPhotoKind" NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustodyPhoto_companyId_idx" ON "CustodyPhoto"("companyId");

-- CreateIndex
CREATE INDEX "CustodyPhoto_custodyId_idx" ON "CustodyPhoto"("custodyId");

-- AddForeignKey
ALTER TABLE "CustodyPhoto" ADD CONSTRAINT "CustodyPhoto_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyPhoto" ADD CONSTRAINT "CustodyPhoto_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "AssetCustody"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
