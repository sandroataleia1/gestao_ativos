-- CreateIndex
CREATE INDEX "Asset_companyId_active_idx" ON "Asset"("companyId", "active");

-- CreateIndex
CREATE INDEX "Asset_companyId_trackingMode_idx" ON "Asset"("companyId", "trackingMode");

-- CreateIndex
CREATE INDEX "AssetCertification_companyId_certificationType_status_expir_idx" ON "AssetCertification"("companyId", "certificationType", "status", "expirationDate");

-- CreateIndex
CREATE INDEX "AssetCustody_companyId_status_expectedReturnAt_idx" ON "AssetCustody"("companyId", "status", "expectedReturnAt");

-- CreateIndex
CREATE INDEX "AssetCustody_companyId_deliveredAt_idx" ON "AssetCustody"("companyId", "deliveredAt");

-- CreateIndex
CREATE INDEX "AssetUnit_currentLocationId_idx" ON "AssetUnit"("currentLocationId");

-- CreateIndex
CREATE INDEX "AssetUnit_statusId_idx" ON "AssetUnit"("statusId");

-- CreateIndex
CREATE INDEX "AssetUnit_conditionId_idx" ON "AssetUnit"("conditionId");

-- CreateIndex
CREATE INDEX "Location_locationTypeId_idx" ON "Location"("locationTypeId");

-- CreateIndex
CREATE INDEX "Location_companyId_active_idx" ON "Location"("companyId", "active");
