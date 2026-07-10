import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { createProviderWithLink, getProviderLinksForCompany } from "@/lib/sst-providers";
import { sstProviderCreateSchema } from "@/lib/validations/sst-provider";

// Retorna vínculos (SstProviderCompany) da empresa atual, nunca uma lista
// global de SstProvider — ver docs/sst-providers.md.
export async function GET() {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_VIEW);

    const links = await getProviderLinksForCompany(companyId);

    return NextResponse.json({ providerLinks: links });
  } catch (error) {
    return handleApiError(error);
  }
}

// Cria o SstProvider e o vínculo (status: PENDING) juntos — autorizar é uma
// ação separada (PATCH /api/sst-providers/[id]).
export async function POST(request: Request) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);

    const body = await request.json();
    const input = sstProviderCreateSchema.parse(body);

    const link = await createProviderWithLink(companyId, { id: user.id, name: user.name }, input);

    return NextResponse.json({ providerLink: link }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
