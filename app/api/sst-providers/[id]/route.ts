import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { updateProviderLinkStatus } from "@/lib/sst-providers";
import { sstProviderLinkStatusUpdateSchema } from "@/lib/validations/sst-provider";

type RouteParams = { params: Promise<{ id: string }> };

// `id` é o id do vínculo (SstProviderCompany), não do SstProvider — é o
// vínculo que pertence à empresa. Autoriza (status: ACTIVE), suspende ou
// revoga.
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);
    const { id } = await params;

    const body = await request.json();
    const input = sstProviderLinkStatusUpdateSchema.parse(body);

    const link = await updateProviderLinkStatus(companyId, { id: user.id, name: user.name }, id, input);

    return NextResponse.json({ providerLink: link });
  } catch (error) {
    return handleApiError(error);
  }
}
