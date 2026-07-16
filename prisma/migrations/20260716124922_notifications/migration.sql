-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('COMPANY', 'SST_PROVIDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('COMPANY_SST_ACCESS_REQUESTED', 'COMPANY_SST_ACCESS_REQUEST_RESOLVED', 'SST_ACCESS_APPROVED', 'SST_ACCESS_REJECTED', 'SST_ACCESS_SUSPENDED', 'SST_ACCESS_REVOKED', 'SST_ACCESS_LEVEL_CHANGED', 'SST_COMPANY_CLAIM_STARTED', 'SST_AUTHORIZATION_CONFIRMED', 'SST_AUTHORIZATION_BLOCKED', 'PLATFORM_COMPANY_CLAIM_REQUESTED', 'PLATFORM_COMPANY_CLAIM_DISPUTED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "companyId" TEXT,
    "sstProviderId" TEXT,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionKey" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationReceipt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_sstProviderId_createdAt_idx" ON "Notification"("sstProviderId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_audience_createdAt_idx" ON "Notification"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_resolvedAt_createdAt_idx" ON "Notification"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_audience_dedupeKey_key" ON "Notification"("audience", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationReceipt_userId_readAt_idx" ON "NotificationReceipt"("userId", "readAt");

-- CreateIndex
CREATE INDEX "NotificationReceipt_userId_dismissedAt_idx" ON "NotificationReceipt"("userId", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationReceipt_notificationId_userId_key" ON "NotificationReceipt"("notificationId", "userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sstProviderId_fkey" FOREIGN KEY ("sstProviderId") REFERENCES "SstProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReceipt" ADD CONSTRAINT "NotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReceipt" ADD CONSTRAINT "NotificationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint (Sprint SST 1.4E, §6) — o Prisma não expressa "campo
-- obrigatório condicionado ao valor de um enum" diretamente no schema, então
-- esta constraint é adicionada manualmente aqui (não gerada pelo `prisma
-- migrate dev`). Garante, no próprio banco, que nunca é possível violar por
-- fora da camada de aplicação (lib/notifications.ts):
--   - audience = COMPANY      -> companyId obrigatório, sstProviderId nulo;
--   - audience = SST_PROVIDER -> sstProviderId obrigatório, companyId nulo;
--   - audience = PLATFORM     -> nenhum dos dois preenchido.
-- Uma notificação nunca pode pertencer simultaneamente a uma Company e a um
-- SstProvider.
ALTER TABLE "Notification" ADD CONSTRAINT "notification_audience_scope_check" CHECK (
  ("audience" = 'COMPANY' AND "companyId" IS NOT NULL AND "sstProviderId" IS NULL) OR
  ("audience" = 'SST_PROVIDER' AND "sstProviderId" IS NOT NULL AND "companyId" IS NULL) OR
  ("audience" = 'PLATFORM' AND "companyId" IS NULL AND "sstProviderId" IS NULL)
);
