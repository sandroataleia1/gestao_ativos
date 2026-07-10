-- CreateEnum
CREATE TYPE "TrainingType" AS ENUM ('LEGAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "InstructorType" AS ENUM ('INTERNAL', 'EXTERNAL', 'BOTH');

-- CreateTable
CREATE TABLE "TrainingTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "trainingType" "TrainingType" NOT NULL,
    "nrReference" TEXT,
    "defaultValidityMonths" INTEGER,
    "defaultWorkloadHours" INTEGER,
    "requiresCertificate" BOOLEAN NOT NULL DEFAULT true,
    "requiresAttendanceList" BOOLEAN NOT NULL DEFAULT true,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "requiresExam" BOOLEAN NOT NULL DEFAULT false,
    "minimumPassingGrade" INTEGER,
    "defaultInstructorType" "InstructorType" NOT NULL DEFAULT 'BOTH',
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTraining" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trainingTemplateId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "trainingType" "TrainingType" NOT NULL,
    "nrReference" TEXT,
    "validityMonths" INTEGER,
    "workloadHours" INTEGER,
    "requiresCertificate" BOOLEAN NOT NULL DEFAULT true,
    "requiresAttendanceList" BOOLEAN NOT NULL DEFAULT true,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "requiresExam" BOOLEAN NOT NULL DEFAULT false,
    "minimumPassingGrade" INTEGER,
    "instructorType" "InstructorType" NOT NULL DEFAULT 'BOTH',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTraining_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTemplate_code_key" ON "TrainingTemplate"("code");

-- CreateIndex
CREATE INDEX "TrainingTemplate_category_idx" ON "TrainingTemplate"("category");

-- CreateIndex
CREATE INDEX "TrainingTemplate_trainingType_idx" ON "TrainingTemplate"("trainingType");

-- CreateIndex
CREATE INDEX "TrainingTemplate_active_idx" ON "TrainingTemplate"("active");

-- CreateIndex
CREATE INDEX "CompanyTraining_companyId_idx" ON "CompanyTraining"("companyId");

-- CreateIndex
CREATE INDEX "CompanyTraining_trainingTemplateId_idx" ON "CompanyTraining"("trainingTemplateId");

-- CreateIndex
CREATE INDEX "CompanyTraining_companyId_active_idx" ON "CompanyTraining"("companyId", "active");

-- CreateIndex
CREATE INDEX "CompanyTraining_companyId_trainingType_idx" ON "CompanyTraining"("companyId", "trainingType");

-- AddForeignKey
ALTER TABLE "CompanyTraining" ADD CONSTRAINT "CompanyTraining_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTraining" ADD CONSTRAINT "CompanyTraining_trainingTemplateId_fkey" FOREIGN KEY ("trainingTemplateId") REFERENCES "TrainingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
