import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { signUpEmailInternal } from "@/lib/auth";
import { isValidCnpj } from "@/lib/cnpj";
import { isValidBrazilianMobilePhone, maskBrazilianMobilePhone } from "@/lib/phone-mask";
import { createSstProviderWithCanonicalDocument } from "@/lib/sst-provider-creation";
import { logPlatformAudit } from "@/lib/platform-audit";
import { ConflictError } from "@/lib/api-errors";

const MIN_PASSWORD_LENGTH = 8;

type RegisterBody = {
  providerName?: unknown;
  cnpj?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Cadastro público de consultoria SST — ao contrário de /api/register
// (Sprint SST 1.4C: nunca concede acesso automático, sempre passa por
// CompanyClaimRequest + aprovação do Super Admin), este cadastro concede
// acesso IMEDIATO como OWNER assim que o formulário é enviado — decisão
// deliberada do usuário, ciente do precedente oposto usado para empresa.
// Ver docs/sst-providers.md.
export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const providerName = asTrimmedString(body.providerName);
  const cnpjInput = asTrimmedString(body.cnpj);
  const name = asTrimmedString(body.name);
  const email = asTrimmedString(body.email).toLowerCase();
  const phoneInput = asTrimmedString(body.phone);
  const password = typeof body.password === "string" ? body.password : "";

  if (!providerName || !cnpjInput || !name || !email || !password) {
    return NextResponse.json({ error: "Preencha todos os campos." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` },
      { status: 400 },
    );
  }
  if (!isValidCnpj(cnpjInput)) {
    return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 });
  }
  if (phoneInput && !isValidBrazilianMobilePhone(phoneInput)) {
    return NextResponse.json(
      { error: "Informe um celular válido, com DDD (ex.: (11) 98765-4321)." },
      { status: 400 },
    );
  }
  const phone = phoneInput ? maskBrazilianMobilePhone(phoneInput) : undefined;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: "Já existe uma conta com este email." }, { status: 409 });
  }

  // Nunca reaproveita uma SstProvider existente — diferente do fluxo de
  // reivindicação de Company, não há aqui um cenário legítimo de
  // "pré-cadastro por terceiro" a reivindicar; um CNPJ já cadastrado é
  // sempre um conflito (ConflictError, tratado pelo próprio serviço).
  let provider: { id: string; name: string };
  try {
    provider = await createSstProviderWithCanonicalDocument({
      name: providerName,
      cnpj: cnpjInput,
      email,
      phone,
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  let userId: string;
  try {
    const result = await signUpEmailInternal({ name, email, password }, request.headers);
    userId = result.user.id;
  } catch {
    return NextResponse.json(
      { error: "Não foi possível criar a conta. Tente novamente." },
      { status: 422 },
    );
  }

  await prisma.sstProviderUser.create({
    data: { providerId: provider.id, userId, role: "OWNER", active: true },
  });

  const forwardedFor = request.headers.get("x-forwarded-for");
  await logPlatformAudit({
    action: "sst_provider.self_registered",
    severity: "INFO",
    source: "WEB",
    actorUserId: userId,
    targetType: "SstProvider",
    targetId: provider.id,
    ipAddress: forwardedFor?.split(",")[0]?.trim(),
    userAgent: request.headers.get("user-agent") ?? undefined,
    metadata: { providerName: provider.name },
  });

  return NextResponse.json({ ok: true });
}
