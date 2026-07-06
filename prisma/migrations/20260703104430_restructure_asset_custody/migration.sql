/*
  Warnings:

  - You are about to drop the column `endDate` on the `AssetCustody` table. All the data in the column will be lost.
  - You are about to drop the column `observations` on the `AssetCustody` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `AssetCustody` table. All the data in the column will be lost.
  - Added the required column `assetId` to the `AssetCustody` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deliveredAt` to the `AssetCustody` table without a default value. This is not possible if the table is not empty.
  - Added the required column `employeeId` to the `AssetCustody` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantity` to the `AssetCustody` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `AssetCustody` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('ACTIVE', 'RETURNED');

-- DropForeignKey
ALTER TABLE "AssetCustody" DROP CONSTRAINT "AssetCustody_assetUnitId_fkey";

-- AlterTable
ALTER TABLE "AssetCustody" DROP COLUMN "endDate",
DROP COLUMN "observations",
DROP COLUMN "startDate",
ADD COLUMN     "assetId" TEXT NOT NULL,
ADD COLUMN     "deliveredAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "employeeId" TEXT NOT NULL,
ADD COLUMN     "expectedReturnAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "quantity" DECIMAL(14,3) NOT NULL,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CustodyStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "assetUnitId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AssetCustody_employeeId_idx" ON "AssetCustody"("employeeId");

-- CreateIndex
CREATE INDEX "AssetCustody_assetId_idx" ON "AssetCustody"("assetId");

-- CreateIndex
CREATE INDEX "AssetCustody_status_idx" ON "AssetCustody"("status");

-- AddForeignKey
ALTER TABLE "AssetCustody" ADD CONSTRAINT "AssetCustody_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCustody" ADD CONSTRAINT "AssetCustody_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCustody" ADD CONSTRAINT "AssetCustody_assetUnitId_fkey" FOREIGN KEY ("assetUnitId") REFERENCES "AssetUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
