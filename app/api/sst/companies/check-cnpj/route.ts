import { NextResponse } from "next/server";

import { requireSstRole } from "@/lib/sst-auth";
import { checkCnpjForProvider } from "@/lib/sst-company-provisioning";
import { sstCompanyCheckCnpjSchema } from "@/lib/validations/sst-provider";
import { handleApiError } from "@/lib/api-errors";

// Verificação SOMENTE LEITURA de CNPJ (fase 1 da tela "Adicionar empresa") —
// nunca cria/altera nada. Só OWNER pode consultar (Sprint Comercial SST 1.4,
// §9) — TECHNICIAN/VIEWER não podem iniciar pré-cadastro nem solicitação de
// acesso. `providerId` sempre vem da sessão (`requireSstRole`), nunca do
// body. Resposta reduzida ao mínimo necessário (§18) — ver
// lib/sst-company-provisioning.ts:checkCnpjForProvider.
export async function POST(request: Request) {
  try {
    const { providerId } = await requireSstRole("OWNER");

    const body = await request.json();
    const input = sstCompanyCheckCnpjSchema.parse(body);

    const result = await checkCnpjForProvider(providerId, input.cnpj);

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
