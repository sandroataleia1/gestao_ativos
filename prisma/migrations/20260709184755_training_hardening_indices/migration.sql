-- CreateIndex
CREATE INDEX "CompanyTraining_managedByProviderId_idx" ON "CompanyTraining"("managedByProviderId");

-- CreateIndex
CREATE INDEX "TrainingParticipant_companyId_expiresAt_idx" ON "TrainingParticipant"("companyId", "expiresAt");
