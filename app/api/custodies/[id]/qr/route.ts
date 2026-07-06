import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getOrCreateCustodyQrToken } from "@/lib/qr-code";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.CUSTODY_MANAGE);
    const { id } = await params;

    const token = await getOrCreateCustodyQrToken(companyId, id);

    return NextResponse.json({ token, url: `/q/${token}` });
  } catch (error) {
    return handleApiError(error);
  }
}
