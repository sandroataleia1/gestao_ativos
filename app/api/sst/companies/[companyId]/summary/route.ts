import { NextResponse } from "next/server";

import { requireSstProviderCompanyAccess } from "@/lib/sst-auth";
import {
  getCompanyTrainingMetrics,
  getCriticalTrainingsForCompany,
  getEmployeesWithPendingTraining,
  getUpcomingClassesForCompany,
} from "@/lib/sst-dashboard";
import { handleApiError } from "@/lib/api-errors";

type RouteParams = { params: Promise<{ companyId: string }> };

// `companyId` vem da URL mas é sempre revalidado contra
// SstProviderCompany.status ACTIVE (requireSstProviderCompanyAccess) antes
// de qualquer leitura — nunca confiado por si só.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await params;
    await requireSstProviderCompanyAccess(companyId);

    const [metrics, upcomingClasses, criticalTrainings, employeesWithPendingTraining] = await Promise.all([
      getCompanyTrainingMetrics(companyId),
      getUpcomingClassesForCompany(companyId),
      getCriticalTrainingsForCompany(companyId),
      getEmployeesWithPendingTraining(companyId),
    ]);

    return NextResponse.json({ metrics, upcomingClasses, criticalTrainings, employeesWithPendingTraining });
  } catch (error) {
    return handleApiError(error);
  }
}
