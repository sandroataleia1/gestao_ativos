import { NextResponse } from "next/server";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { provisionDefaultRolesForCompany } from "@/lib/rbac-provisioning";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";
import { isValidBrazilianMobilePhone, maskBrazilianMobilePhone } from "@/lib/phone-mask";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import { logAudit } from "@/lib/audit";

const MIN_PASSWORD_LENGTH = 8;

type RegisterBody = {
  companyName?: unknown;
  cnpj?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

// Mensagem genérica para CNPJ já pertencente a uma empresa CLAIMED/
// CLAIM_PENDING/DISPUTED — nunca revela dados internos da empresa
// encontrada (§21).
const CNPJ_ALREADY_REGISTERED_MESSAGE = "Já existe uma empresa cadastrada com este CNPJ.";

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Registro público = "criar minha empresa" OU "reivindicar um pré-cadastro
// existente" (Sprint Comercial SST 1.4, §16). Nunca reutiliza uma Company a
// partir de um id vindo do client — a única forma de "reutilizar" uma
// Company existente é encontrá-la pelo CNPJ normalizado no servidor, e só
// quando ela está UNCLAIMED (pré-cadastrada por uma consultoria, ainda sem
// dono real). Empresa CLAIMED/CLAIM_PENDING/DISPUTED nunca é reutilizada —
// devolve sempre a mesma mensagem genérica, sem revelar qual é o motivo.
export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const companyName = asTrimmedString(body.companyName);
  const cnpjInput = asTrimmedString(body.cnpj);
  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email).toLowerCase();
  const phoneInput = asTrimmedString(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!companyName || !cnpjInput || !name || !email || !password) {
    return NextResponse.json({ error: "Preencha todos os campos." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` },
      { status: 400 },
    );
  }
  // CNPJ obrigatório desde a Sprint Comercial SST 1.4, §5 — nunca confia na
  // máscara/normalização já feita no client; sempre revalida e normaliza no
  // servidor antes de qualquer leitura/escrita.
  if (!isValidCnpj(cnpjInput)) {
    return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 });
  }
  const documentNormalized = normalizeCnpj(cnpjInput);
  const documentOriginal = formatCnpj(cnpjInput);
  // Celular é opcional — mas se informado, precisa ser um celular
  // brasileiro válido (nunca confia só na máscara aplicada no client).
  if (phoneInput && !isValidBrazilianMobilePhone(phoneInput)) {
    return NextResponse.json(
      { error: "Informe um celular válido, com DDD (ex.: (11) 98765-4321)." },
      { status: 400 },
    );
  }
  const phone = phoneInput ? maskBrazilianMobilePhone(phoneInput) : undefined;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json(
      { error: "Já existe uma conta com este email." },
      { status: 409 },
    );
  }

  const existingCompany = await prisma.company.findFirst({
    where: { documentType: "CNPJ", documentNormalized },
    select: { id: true, name: true, controlStatus: true },
  });

  // CLAIMED (já tem dono real), CLAIM_PENDING (outra reivindicação em
  // andamento) ou DISPUTED — nunca reutilizado, nunca revela o motivo exato.
  if (existingCompany && existingCompany.controlStatus !== "UNCLAIMED") {
    return NextResponse.json({ error: CNPJ_ALREADY_REGISTERED_MESSAGE }, { status: 409 });
  }

  const isClaim = Boolean(existingCompany);
  let company: { id: string; name: string };
  if (existingCompany) {
    // Reivindicação (§16): NUNCA cria uma segunda Company — reaproveita a
    // que a consultoria pré-cadastrou. O nome informado no formulário não
    // sobrescreve o nome já registrado (evita que qualquer um que descubra
    // o CNPJ altere dados exibidos antes mesmo de a conta existir).
    company = existingCompany;
  } else {
    try {
      company = await prisma.company.create({
        data: { name: companyName, phone, document: documentOriginal, documentType: "CNPJ", documentOriginal, documentNormalized },
      });
    } catch (error) {
      // Cinturão de segurança contra corrida (duas requisições de registro
      // com o mesmo CNPJ ao mesmo tempo) — a checagem acima já cobre o caso
      // comum, isto pega só a janela entre o SELECT e o INSERT. A
      // constraint única (documentType, documentNormalized) é a fonte
      // final de verdade.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: CNPJ_ALREADY_REGISTERED_MESSAGE }, { status: 409 });
      }
      throw error;
    }
  }

  // Uma Company pré-cadastrada pela consultoria nunca teve RBAC/lookups
  // provisionados (só Company + SstProviderCompany são criados no
  // pré-cadastro) — precisa acontecer agora, na primeira vez que um usuário
  // real se cadastra sobre ela, igual ao caminho de empresa nova.
  const roles = await provisionDefaultRolesForCompany(company.id);
  await provisionDefaultAssetStatusesAndConditions(company.id);
  await provisionDefaultStockSetup(company.id);

  let userId: string;
  try {
    const result = await signUpEmailInternal(
      { name, email, password, companyId: company.id },
      request.headers,
    );
    userId = result.user.id;
  } catch {
    return NextResponse.json(
      { error: "Não foi possível criar a conta. Tente novamente." },
      { status: 422 },
    );
  }

  const adminRole = roles.get(SYSTEM_ROLES.ADMIN)!;
  let claimPending = false;
  // Sprint 0.6: sem uma CompanyMembership ACTIVE aqui, o admin recém-criado
  // fica bloqueado (NO_ACTIVE_MEMBERSHIP) na primeira requisição, já que
  // CompanyMembership é a fonte real de autorização desde a Sprint 0.5 (ver
  // docs/adr/ADR-001). `status: ACTIVE`/`activatedAt: now` diretos (não
  // INVITED) — é o próprio usuário se auto-registrando/reivindicando como
  // dono da empresa, não um convite de terceiro.
  await prisma.$transaction(async (tx) => {
    await tx.userRole.create({ data: { userId, companyId: company.id, roleId: adminRole.id } });
    await tx.companyMembership.create({
      data: { userId, companyId: company.id, status: "ACTIVE", activatedAt: new Date() },
    });

    if (isClaim) {
      // §16: a reivindicação nunca conclui sozinha — se existir ao menos um
      // vínculo provisório (authorizationBasis: PROVIDER_PRE_REGISTRATION)
      // ainda não revisado, a empresa fica CLAIM_PENDING até decidir sobre
      // cada um (ver lib/company-claim.ts). Sem nenhum vínculo provisório
      // pendente (caso raro), a reivindicação já finaliza como CLAIMED.
      const unresolvedCount = await tx.sstProviderCompany.count({
        where: { companyId: company.id, authorizationBasis: "PROVIDER_PRE_REGISTRATION", status: "ACTIVE", companyReviewedAt: null },
      });
      claimPending = unresolvedCount > 0;
      await tx.company.update({
        where: { id: company.id },
        data: claimPending ? { controlStatus: "CLAIM_PENDING" } : { controlStatus: "CLAIMED", claimedAt: new Date() },
      });
      await logAudit(tx, {
        companyId: company.id,
        actorUserId: userId,
        actorName: name,
        action: "company.claim_started",
        targetType: "Company",
        targetId: company.id,
        targetLabel: company.name,
        metadata: { claimPending },
      });
    }
  });

  return NextResponse.json({ ok: true, claimPending });
}
