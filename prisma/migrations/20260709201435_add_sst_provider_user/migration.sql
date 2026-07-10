-- CreateEnum
CREATE TYPE "SstProviderUserRole" AS ENUM ('OWNER', 'TECHNICIAN', 'VIEWER');

-- CreateTable
CREATE TABLE "SstProviderUser" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SstProviderUserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SstProviderUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SstProviderUser_providerId_idx" ON "SstProviderUser"("providerId");

-- CreateIndex
CREATE INDEX "SstProviderUser_userId_idx" ON "SstProviderUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SstProviderUser_providerId_userId_key" ON "SstProviderUser"("providerId", "userId");

-- AddForeignKey
ALTER TABLE "SstProviderUser" ADD CONSTRAINT "SstProviderUser_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "SstProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SstProviderUser" ADD CONSTRAINT "SstProviderUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
