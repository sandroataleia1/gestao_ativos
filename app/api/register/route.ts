import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { provisionDefaultRolesForCompany } from "@/lib/rbac-provisioning";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";
import { isValidBrazilianMobilePhone, maskBrazilianMobilePhone } from "@/lib/phone-mask";
import { isValidCnpj } from "@/lib/cnpj";
import { createCompanyWithCanonicalDocument, findCompanyByCnpj } from "@/lib/company-creation";
import { createOrReuseClaimRequest } from "@/lib/company-claim-request";
import { ConflictError } from "@/lib/api-errors";

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

  const existingCompany = await findCompanyByCnpj(cnpjInput);

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
      // lib/company-creation.ts — mesmo serviço central usado pelo
      // pré-cadastro da consultoria (lib/sst-company-provisioning.ts); a
      // checagem acima já cobre o caso comum, a constraint única
      // (documentType, documentNormalized) é a fonte final de verdade
      // contra corrida (duas requisições de registro com o mesmo CNPJ ao
      // mesmo tempo) — ConflictError vira a mesma mensagem segura.
      //
      // Sprint SST 1.4C, §9 — mesmo um CNPJ ainda inexistente não comprova
      // representação legal: a Company nasce CLAIM_PENDING (nunca CLAIMED
      // automaticamente), igual ao caminho de reivindicação de uma empresa
      // pré-cadastrada. O registro público fica temporariamente sem efeito
      // prático sem um Super Admin Lite aprovando cada solicitação — essa
      // limitação é aceita deliberadamente como contenção de segurança.
      company = await createCompanyWithCanonicalDocument({
        name: companyName,
        cnpj: cnpjInput,
        origin: "SELF_REGISTRATION",
        controlStatus: "CLAIM_PENDING",
        phone,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        return NextResponse.json({ error: CNPJ_ALREADY_REGISTERED_MESSAGE }, { status: 409 });
      }
      throw error;
    }
  }

  // Uma Company pré-cadastrada pela consultoria (ou recém-criada aqui)
  // ainda não tem RBAC/lookups provisionados — precisa acontecer agora,
  // ANTES da aprovação, para que `approveCompanyClaimRequest` só precise
  // procurar o papel ADMIN já existente (nunca provisiona nada durante a
  // aprovação em si — serviço de aprovação fica mais simples e mais óbvio
  // de auditar).
  await provisionDefaultRolesForCompany(company.id);
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

  // Contenção P0 (Sprint SST 1.4C) — este ponto do código NUNCA cria
  // CompanyMembership/UserRole diretamente. Só conhecer o CNPJ (empresa
  // nova ou pré-cadastrada) nunca comprova representação legal; a única
  // forma de um usuário passar a administrar uma Company é através de uma
  // CompanyClaimRequest aprovada explicitamente por um humano (futuro Super
  // Admin Lite) — ver lib/company-claim-request.ts:approveCompanyClaimRequest.
  await createOrReuseClaimRequest({
    companyId: company.id,
    requester: { id: userId, name },
    origin: isClaim ? "EXISTING_PRE_REGISTRATION" : "SELF_REGISTRATION",
  });

  return NextResponse.json({ ok: true, status: "CLAIM_REVIEW_REQUIRED" });
}
