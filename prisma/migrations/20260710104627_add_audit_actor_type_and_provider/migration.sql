-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('COMPANY_USER', 'SST_PROVIDER_USER');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorType" "AuditActorType" NOT NULL DEFAULT 'COMPANY_USER',
ADD COLUMN     "providerId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_providerId_idx" ON "AuditLog"("providerId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "SstProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
