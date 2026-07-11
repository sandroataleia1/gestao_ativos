import { NextResponse, type NextRequest } from "next/server";

import { requireSstAuth, requireSstRole } from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import { handleApiError } from "@/lib/api-errors";
import { isTrustedOrigin } from "@/lib/request-origin";
import { addExistingUserToTeam, listTeamMembers } from "@/lib/sst-team";
import { addTeamMemberSchema } from "@/lib/validations/sst-team";
import { logInfo, logWarn } from "@/lib/logger";

// GET/POST /api/sst/team — Sprint Demo Comercial SST 1.0, Parte 3.
//
// GET: qualquer membro autenticado da consultoria pode ver a equipe
// (OWNER/TECHNICIAN/VIEWER) — e-mail só é incluído quando o requisitante é
// OWNER ("e-mail, somente para usuários autorizados da própria
// consultoria").
export async function GET() {
  try {
    const ctx = await requireSstAuth();
    const includeEmail = ctx.sstProviderUser.role === "OWNER";
    const members = await listTeamMembers(ctx.providerId, ctx.user.id, includeEmail);
    return NextResponse.json({ members });
  } catch (error) {
    return handleApiError(error);
  }
}

const GENERIC_RESPONSE = {
  message: "Caso exista uma conta elegível para esse endereço, o acesso ficará disponível para o usuário.",
};

// POST: só OWNER. Adiciona um usuário GLOBAL EXISTENTE diretamente (sem
// convite pendente — o modelo atual de SstProviderUser não distingue esse
// estado; ver lib/sst-team.ts). Resposta sempre genérica, independente de o
// e-mail ter conta ou já ser membro — mesma disciplina anti-enumeração do
// convite de CompanyMembership (Sprint 0.6).
export async function POST(request: NextRequest) {
  try {
    if (!isTrustedOrigin(request)) {
      throw new ForbiddenError("Origem da requisição não confiável.");
    }

    // 1/2/3: exige OWNER; providerId sempre da sessão, nunca do body.
    const ctx = await requireSstRole("OWNER");

    const rawBody = await request.json();
    // 4: normaliza o e-mail (trim + lowercase) antes da validação de formato.
    const normalizedBody = {
      ...rawBody,
      email: typeof rawBody?.email === "string" ? rawBody.email.trim().toLowerCase() : rawBody?.email,
    };
    const input = addTeamMemberSchema.parse(normalizedBody);

    const result = await addExistingUserToTeam({
      providerId: ctx.providerId,
      email: input.email,
      role: input.role,
    });

    // 5/6: resposta externa idêntica em qualquer caso — nunca revela se o
    // e-mail existe, se já é membro desta ou de outra consultoria/empresa.
    if (result.status === "ADDED") {
      // 10: log estruturado sem e-mail (só ids opacos) — não há companyId
      // aqui (ação é interna ao provider), então não cabe AuditLog
      // (Company obrigatória); log estruturado é o registro adequado.
      logInfo("sst_team_member_added", {
        providerId: ctx.providerId,
        actorUserId: ctx.user.id,
        role: input.role,
      });
    } else if (result.status === "ALREADY_MEMBER") {
      logInfo("sst_team_add_already_member", { providerId: ctx.providerId, actorUserId: ctx.user.id });
    } else {
      logWarn("sst_team_add_user_not_found", { providerId: ctx.providerId, actorUserId: ctx.user.id });
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    return handleApiError(error);
  }
}
