import { NextResponse } from "next/server";

import { requireSstAuth } from "@/lib/sst-auth";
import { getProviderDashboardSummary } from "@/lib/sst-dashboard";
import { handleApiError } from "@/lib/api-errors";

// `providerId` vem sempre da sessão (via requireSstAuth), nunca de query
// string ou body — nunca aceito do client.
export async function GET() {
  try {
    const { providerId } = await requireSstAuth();

    const summary = await getProviderDashboardSummary(providerId);

    return NextResponse.json({ summary });
  } catch (error) {
    return handleApiError(error);
  }
}
