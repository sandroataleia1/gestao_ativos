-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "qrCodeToken" TEXT;

-- AlterTable
ALTER TABLE "AssetCustody" ADD COLUMN     "qrCodeToken" TEXT;

-- AlterTable
ALTER TABLE "AssetUnit" ADD COLUMN     "qrCodeToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_qrCodeToken_key" ON "Asset"("qrCodeToken");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCustody_qrCodeToken_key" ON "AssetCustody"("qrCodeToken");

-- CreateIndex
CREATE UNIQUE INDEX "AssetUnit_qrCodeToken_key" ON "AssetUnit"("qrCodeToken");
