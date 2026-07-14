import { NextResponse } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { requestAccessToCompany } from "@/lib/sst-company-provisioning";
import { sstCompanyRequestAccessSchema } from "@/lib/validations/sst-provider";
import { handleApiError } from "@/lib/api-errors";

// Solicita autorização para uma empresa JÁ EXISTENTE a partir do CNPJ
// (Sprint Comercial SST 1.4, §12) — nunca concede acesso imediato (nasce
// sempre PENDING); nunca duplica um vínculo já ACTIVE/PENDING; nunca
// reativa SUSPENDED/REVOKED/REJECTED automaticamente. Só OWNER (§9);
// `providerId` sempre da sessão, nunca do body.
export async function POST(request: Request) {
  try {
    const { providerId, user } = await requireSstRole("OWNER");

    const body = await request.json();
    const input = sstCompanyRequestAccessSchema.parse(body);

    const result = await requestAccessToCompany(providerId, { id: user.id, name: user.name }, input.cnpj);

    return NextResponse.json(result, { status: result.status === "AUTHORIZATION_REQUESTED" ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
