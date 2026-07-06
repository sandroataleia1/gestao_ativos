/*
  Warnings:

  - Added the required column `conditionId` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `statusId` to the `Asset` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "conditionId" TEXT NOT NULL,
ADD COLUMN     "statusId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- CreateIndex
CREATE INDEX "Asset_manufacturerId_idx" ON "Asset"("manufacturerId");

-- CreateIndex
CREATE INDEX "Asset_supplierId_idx" ON "Asset"("supplierId");

-- CreateIndex
CREATE INDEX "Asset_statusId_idx" ON "Asset"("statusId");

-- CreateIndex
CREATE INDEX "Asset_conditionId_idx" ON "Asset"("conditionId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "AssetStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "AssetCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
