import { NextResponse } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { preRegisterCompany } from "@/lib/sst-company-provisioning";
import { sstCompanyPreRegisterSchema } from "@/lib/validations/sst-provider";
import { handleApiError } from "@/lib/api-errors";

// Pré-cadastro de empresa NOVA a partir do CNPJ (Sprint Comercial SST 1.4,
// §11). Body aceito é só `{ cnpj, name }` — o Zod já ignora qualquer outro
// campo (providerId/companyId/controlStatus/origin/createdByProviderId/
// accessLevel/status), então mesmo que o client mande esses campos eles
// nunca chegam ao service. Só OWNER (§9); `providerId` sempre da sessão.
export async function POST(request: Request) {
  try {
    const { providerId, user } = await requireSstRole("OWNER");

    const body = await request.json();
    const input = sstCompanyPreRegisterSchema.parse(body);

    const result = await preRegisterCompany(providerId, { id: user.id, name: user.name }, input);

    if (result.created) return NextResponse.json(result, { status: 201 });
    // Outra requisição já criou a empresa para este CNPJ (corrida ou
    // duplicata) — nunca uma segunda Company. ALREADY_AUTHORIZED/
    // ALREADY_PROVISIONALLY_AUTHORIZED (a própria consultoria já tem acesso,
    // real ou provisório) é informativo (200); os demais indicam que um
    // pedido PENDING foi registrado no lugar da administração imediata (409).
    const alreadyHasAccess = result.reason === "ALREADY_AUTHORIZED" || result.reason === "ALREADY_PROVISIONALLY_AUTHORIZED";
    return NextResponse.json(result, { status: alreadyHasAccess ? 200 : 409 });
  } catch (error) {
    return handleApiError(error);
  }
}
