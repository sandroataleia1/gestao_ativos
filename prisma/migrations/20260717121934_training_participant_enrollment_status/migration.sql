-- CreateEnum
CREATE TYPE "TrainingParticipantEnrollmentStatus" AS ENUM ('ENROLLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "TrainingParticipant" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "enrollmentStatus" "TrainingParticipantEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED';

-- CreateIndex
CREATE INDEX "TrainingParticipant_trainingClassId_enrollmentStatus_idx" ON "TrainingParticipant"("trainingClassId", "enrollmentStatus");

-- Sprint SST 1.4G, §6 — CHECK manual (Prisma não expressa "campo obrigatório
-- condicionado ao valor de um enum" declarativamente, mesmo padrão já usado
-- na migration de Notification, Sprint SST 1.4E): cancelledAt NUNCA
-- preenchido enquanto ENROLLED, SEMPRE preenchido quando CANCELLED. Defesa
-- em profundidade no banco, além da validação de serviço em
-- lib/training-participants.ts.
ALTER TABLE "TrainingParticipant" ADD CONSTRAINT "training_participant_cancelled_at_check" CHECK (
  ("enrollmentStatus" = 'ENROLLED' AND "cancelledAt" IS NULL) OR
  ("enrollmentStatus" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
);
