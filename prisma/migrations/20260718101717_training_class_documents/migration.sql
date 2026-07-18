-- CreateEnum
CREATE TYPE "TrainingClassDocumentType" AS ENUM ('ATTENDANCE_LIST', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "TrainingClassDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trainingClassId" TEXT NOT NULL,
    "type" "TrainingClassDocumentType" NOT NULL,
    "participantId" TEXT,
    "contentHtml" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingClassDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingClassSignature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerDocument" TEXT NOT NULL,
    "signatureImageUrl" TEXT,
    "signatureData" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingClassSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingClassDocument_companyId_idx" ON "TrainingClassDocument"("companyId");

-- CreateIndex
CREATE INDEX "TrainingClassDocument_trainingClassId_idx" ON "TrainingClassDocument"("trainingClassId");

-- CreateIndex
CREATE INDEX "TrainingClassDocument_participantId_idx" ON "TrainingClassDocument"("participantId");

-- CreateIndex
CREATE INDEX "TrainingClassSignature_companyId_idx" ON "TrainingClassSignature"("companyId");

-- CreateIndex
CREATE INDEX "TrainingClassSignature_documentId_idx" ON "TrainingClassSignature"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingClassSignature_documentId_participantId_key" ON "TrainingClassSignature"("documentId", "participantId");

-- AddForeignKey
ALTER TABLE "TrainingClassDocument" ADD CONSTRAINT "TrainingClassDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClassDocument" ADD CONSTRAINT "TrainingClassDocument_trainingClassId_fkey" FOREIGN KEY ("trainingClassId") REFERENCES "TrainingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClassDocument" ADD CONSTRAINT "TrainingClassDocument_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClassSignature" ADD CONSTRAINT "TrainingClassSignature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClassSignature" ADD CONSTRAINT "TrainingClassSignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TrainingClassDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingClassSignature" ADD CONSTRAINT "TrainingClassSignature_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sprint SST 1.4H, fatia 2 — CHECK manual (Prisma não expressa "campo
-- obrigatório condicionado ao valor de um enum" declarativamente, mesmo
-- padrão já usado na migration de TrainingParticipant.enrollmentStatus):
-- participantId SEMPRE preenchido para CERTIFICATE (documento individual),
-- SEMPRE null para ATTENDANCE_LIST (documento único da turma).
ALTER TABLE "TrainingClassDocument" ADD CONSTRAINT "training_class_document_participant_check" CHECK (
  ("type" = 'CERTIFICATE' AND "participantId" IS NOT NULL) OR
  ("type" = 'ATTENDANCE_LIST' AND "participantId" IS NULL)
);
