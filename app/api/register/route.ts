import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { provisionDefaultRolesForCompany } from "@/lib/rbac-provisioning";
import { provisionDefaultAssetStatusesAndConditions } from "@/lib/asset-lookup-provisioning";
import { provisionDefaultStockSetup } from "@/lib/stock-setup-provisioning";
import { isValidBrazilianMobilePhone, maskBrazilianMobilePhone } from "@/lib/phone-mask";

const MIN_PASSWORD_LENGTH = 8;

type RegisterBody = {
  companyName?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

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
  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email).toLowerCase();
  const phoneInput = asTrimmedString(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!companyName || !name || !email || !password) {
    return NextResponse.json({ error: "Preencha todos os campos." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` },
      { status: 400 },
    );
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

  const company = await prisma.company.create({ data: { name: companyName, phone } });
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
