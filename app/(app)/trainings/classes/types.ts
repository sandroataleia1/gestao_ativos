import type { CompanyTraining, TrainingClass } from "@/app/generated/prisma/client";

export type TrainingClassRow = TrainingClass & {
  companyTraining: Pick<CompanyTraining, "id" | "title">;
  _count: { participants: number };
};

export type CompanyTrainingOption = Pick<CompanyTraining, "id" | "title" | "trainingType" | "category">;
