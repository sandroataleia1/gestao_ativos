import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { getLinkedCompaniesWithMetrics } from "@/lib/sst-dashboard";
import { handleApiError } from "@/lib/api-errors";

// Só empresas com SstProviderCompany.status ACTIVE para o provider da
// sessão — nunca uma empresa sem vínculo ACTIVE, nunca outro provider.
export async function GET() {
  try {
    const { providerId } = await requireSstAuth();

    const companies = await getLinkedCompaniesWithMetrics(providerId);

    return NextResponse.json({ companies });
  } catch (error) {
    return handleApiError(error);
  }
}
