import { NextResponse, type NextRequest } from "next/server";

import {
  ForbiddenError,
  requireAuth,
  resolveCurrentCompanyContext,
} from "@/lib/auth-server";
import { handleApiError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import {
  clearRequestedCompanyId,
  setRequestedCompanyId,
} from "@/lib/company-context-request";
import {
  listAvailableCompanyContexts,
  listPendingCompanyInvitations,
  selectCompanyContext,
} from "@/lib/company-selection";
import { companyContextSelectSchema } from "@/lib/validations/company-context";

// GET/POST/DELETE /api/company-context — Sprint 0.6, Parte C. Base da UI de
// seleção de empresa (Parte D/E): nunca confia em nenhum dado vindo do
// client para decidir autorização — todo POST revalida contra
// CompanyMembership via lib/company-selection.ts (que delega ao resolver
// central, lib/company-context.ts).

export async function GET() {
  try {
    const user = await requireAuth();

    const [current, availableCompanies, pendingInvitations] = await Promise.all([
      resolveCurrentCompanyContext(),
      listAvailableCompanyContexts(user.id),
      listPendingCompanyInvitations(user.id),
    ]);

    const currentCompany =
      current?.status === "RESOLVED"
        ? { companyId: current.companyId, membershipId: current.membershipId, source: current.source }
        : null;

    return NextResponse.json({
      currentCompany,
      availableCompanies,
      pendingInvitations,
      selectionRequired: current?.status === "SELECTION_REQUIRED",
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // Usuário exclusivamente da sessão — nunca de um parâmetro do client.
    const user = await requireAuth();

    const body = await request.json();
    const { companyId } = companyContextSelectSchema.parse(body);

    const result = await selectCompanyContext(user.id, companyId);

    if (result.status !== "RESOLVED") {
      // INVALID_REQUESTED_CONTEXT, COMPANY_UNAVAILABLE (ou, defensivamente,
      // qualquer outro status não esperado nesta chamada) — sempre a mesma
      // resposta genérica, nunca revelando se a empresa existe/qual o motivo
      // exato (Sprint 0.6, Parte D: "não revelar a existência da empresa
      // solicitada").
      throw new ForbiddenError("Empresa não disponível para seleção.");
    }

    // Cookie só é gravado DEPOIS da autorização confirmada.
    await setRequestedCompanyId(result.companyId);

    return NextResponse.json({
      companyId: result.companyId,
      membershipId: result.membershipId,
      source: result.source,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // Exige sessão (mesmo não usando o `companyId` resolvido) — evita que
    // qualquer requisição anônima limpe cookies de terceiros por engano;
    // na prática o navegador só envia o cookie do próprio usuário mesmo.
    await requireAuth();

    // Nunca revoga membership nem altera User.companyId — só remove a
    // preferência de contexto.
    await clearRequestedCompanyId();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
