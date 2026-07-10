import type { CompanyTraining, SstProvider, SstProviderCompany, TrainingTemplate } from "@/app/generated/prisma/client";

export type CompanyTrainingRow = CompanyTraining & {
  managedByProvider:
    | (Pick<SstProvider, "id" | "name"> & { companyLinks: Pick<SstProviderCompany, "status">[] })
    | null;
};
export type TrainingTemplateOption = TrainingTemplate;
export type SstProviderOption = Pick<SstProvider, "id" | "name">;
