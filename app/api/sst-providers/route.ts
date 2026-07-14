import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { getProviderLinksForCompany, linkExistingProvider } from "@/lib/sst-providers";
import { sstProviderLinkCreateSchema } from "@/lib/validations/sst-provider";

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

// Vincula um SstProvider já existente (encontrado via
// GET /api/sst-providers/search) — status: PENDING. Autorizar é uma ação
// separada (PATCH /api/sst-providers/[id]). Nunca cria um SstProvider novo
// — ver lib/sst-providers.ts, linkExistingProvider.
export async function POST(request: Request) {
  try {
    const { user, companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);

    const body = await request.json();
    const input = sstProviderLinkCreateSchema.parse(body);

    const link = await linkExistingProvider(companyId, { id: user.id, name: user.name }, input);

    return NextResponse.json({ providerLink: link }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
