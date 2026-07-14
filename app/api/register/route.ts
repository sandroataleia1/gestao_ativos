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

const MIN_PASSWORD_LENGTH = 8;

type RegisterBody = {
  companyName?: unknown;
  cnpj?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

// Mensagem exata definida pela Sprint Comercial SST 1.4, §7 — usada quando o
// CNPJ informado já pertence a uma empresa pré-cadastrada (UNCLAIMED, ainda
// sem dono real) por uma consultoria SST. Nunca cria uma segunda Company
// nem revela nenhum dado da empresa existente; o fluxo completo de
// reivindicação (CompanyClaim) é fora de escopo desta sprint.
const CNPJ_UNCLAIMED_MESSAGE =
  "Esta empresa já possui um pré-cadastro. O acesso empresarial deverá ser solicitado pelo fluxo de reivindicação.";
// Mensagem genérica para qualquer outro caso de CNPJ já cadastrado (empresa
// já reivindicada por outra conta, ou corrida concorrente onde não é
// seguro/necessário diferenciar o motivo) — nunca revela dados internos da
// empresa encontrada.
const CNPJ_ALREADY_REGISTERED_MESSAGE = "Já existe uma empresa cadastrada com este CNPJ.";

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Registro público = "criar minha empresa": cria uma Company nova (nunca
// reutiliza uma existente a partir de um id vindo do client) e o primeiro
// usuário dessa empresa entra automaticamente como ADMIN.
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
  // CNPJ obrigatório desde a Sprint Comercial SST 1.4, §7 — nunca confia na
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

  // Nunca cria uma segunda Company para o mesmo CNPJ — se já existe (por
  // pré-cadastro de consultoria SST ou cadastro real anterior), devolve uma
  // mensagem segura sem revelar nenhum dado interno da empresa encontrada
  // (ver §7/§18: nunca mais informação que o necessário).
  const existingCompany = await prisma.company.findFirst({
    where: { documentType: "CNPJ", documentNormalized },
    select: { id: true, controlStatus: true },
  });
  if (existingCompany) {
    const message =
      existingCompany.controlStatus === "UNCLAIMED" ? CNPJ_UNCLAIMED_MESSAGE : CNPJ_ALREADY_REGISTERED_MESSAGE;
    return NextResponse.json({ error: message }, { status: 409 });
  }

  let company;
  try {
    company = await prisma.company.create({
      data: { name: companyName, phone, document: documentOriginal, documentType: "CNPJ", documentOriginal, documentNormalized },
    });
  } catch (error) {
    // Cinturão de segurança contra corrida (duas requisições de registro com
    // o mesmo CNPJ ao mesmo tempo) — a checagem acima já cobre o caso comum,
    // isto pega só a janela entre o SELECT e o INSERT. A constraint única
    // (documentType, documentNormalized) é a fonte final de verdade.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: CNPJ_ALREADY_REGISTERED_MESSAGE }, { status: 409 });
    }
    throw error;
  }
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
  // Sprint 0.6: sem uma CompanyMembership ACTIVE aqui, o admin recém-criado
  // fica bloqueado (NO_ACTIVE_MEMBERSHIP) na primeira requisição, já que
  // CompanyMembership é a fonte real de autorização desde a Sprint 0.5 (ver
  // docs/adr/ADR-001). `status: ACTIVE`/`activatedAt: now` diretos (não
  // INVITED) — é o próprio usuário se auto-registrando como dono da empresa
  // que ele acabou de criar, não um convite de terceiro.
  await prisma.$transaction([
    prisma.userRole.create({
      data: { userId, companyId: company.id, roleId: adminRole.id },
    }),
    prisma.companyMembership.create({
      data: { userId, companyId: company.id, status: "ACTIVE", activatedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
