-- CreateEnum
CREATE TYPE "TrainingClassStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TrainingClass" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyTrainingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TrainingClassStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "internalInstructor" TEXT,
    "externalInstructor" TEXT,
    "maximumParticipants" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingClass_companyId_idx" ON "TrainingClass"("companyId");

-- CreateIndex
CREATE INDEX "TrainingClass_companyTrainingId_idx" ON "TrainingClass"("companyTrainingId");

-- CreateIndex
CREATE INDEX "TrainingClass_companyId_status_idx" ON "TrainingClass"("companyId", "status");

-- CreateIndex
CREATE INDEX "TrainingClass_companyId_startsAt_idx" ON "TrainingClass"("companyId", "startsAt");

-- AddForeignKey
ALTER TABLE "TrainingClass" ADD CONSTRAINT "TrainingClass_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClass" ADD CONSTRAINT "TrainingClass_companyTrainingId_fkey" FOREIGN KEY ("companyTrainingId") REFERENCES "CompanyTraining"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
