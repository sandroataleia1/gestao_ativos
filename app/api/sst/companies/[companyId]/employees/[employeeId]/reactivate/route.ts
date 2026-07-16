import { NextResponse } from "next/server";

import { requireSstProviderEmployeeManageAccess, buildSstActor } from "@/lib/sst-auth";
import { reactivateEmployeeForCompany } from "@/lib/employees";
import { handleApiError } from "@/lib/api-errors";
import { requireTrustedMutationOrigin } from "@/lib/mutation-origin";

type RouteParams = { params: Promise<{ companyId: string; employeeId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    requireTrustedMutationOrigin(request);
    const { companyId, employeeId } = await params;
    const ctx = await requireSstProviderEmployeeManageAccess(companyId);

    const employee = await reactivateEmployeeForCompany(companyId, employeeId, buildSstActor(ctx));

    return NextResponse.json({ employee });
  } catch (error) {
    return handleApiError(error);
  }
}
