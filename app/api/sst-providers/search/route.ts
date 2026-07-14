import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { handleApiError } from "@/lib/api-errors";
import { searchAuthorizableProviders } from "@/lib/sst-providers";

// Busca prestadores SST já cadastrados no sistema, por nome — para a
// empresa selecionar e autorizar (nunca cria um SstProvider novo aqui).
// `companyId` sempre vem do contexto resolvido no servidor; a busca em si é
// sobre SstProvider (global), mas o resultado já exclui prestadores que já
// têm vínculo com ESTA empresa (ver lib/sst-providers.ts). Mesma permissão
// exigida para gerenciar vínculos — só quem pode criar um vínculo pode
// pesquisar candidatos.
export async function GET(request: Request) {
  try {
    const { companyId } = await requirePermission(PERMISSIONS.SST_PROVIDER_MANAGE);

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";

    const providers = await searchAuthorizableProviders(companyId, query);

    return NextResponse.json({ providers });
  } catch (error) {
    return handleApiError(error);
  }
}
