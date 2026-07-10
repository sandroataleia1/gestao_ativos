-- CreateEnum
CREATE TYPE "TrainingAttendanceStatus" AS ENUM ('ENROLLED', 'PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "TrainingResultStatus" AS ENUM ('PENDING', 'APPROVED', 'FAILED');

-- CreateTable
CREATE TABLE "TrainingParticipant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trainingClassId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceStatus" "TrainingAttendanceStatus" NOT NULL DEFAULT 'ENROLLED',
    "resultStatus" "TrainingResultStatus" NOT NULL DEFAULT 'PENDING',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingParticipant_companyId_idx" ON "TrainingParticipant"("companyId");

-- CreateIndex
CREATE INDEX "TrainingParticipant_trainingClassId_idx" ON "TrainingParticipant"("trainingClassId");

-- CreateIndex
CREATE INDEX "TrainingParticipant_employeeId_idx" ON "TrainingParticipant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingParticipant_companyId_trainingClassId_employeeId_key" ON "TrainingParticipant"("companyId", "trainingClassId", "employeeId");

-- AddForeignKey
ALTER TABLE "TrainingParticipant" ADD CONSTRAINT "TrainingParticipant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingParticipant" ADD CONSTRAINT "TrainingParticipant_trainingClassId_fkey" FOREIGN KEY ("trainingClassId") REFERENCES "TrainingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingParticipant" ADD CONSTRAINT "TrainingParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
