import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@/lib/prisma";

// Header interno que só o próprio servidor pode enviar (nunca alcançável a
// partir de um POST externo direto a /api/auth/sign-up/email) — ver
// `signUpEmailInternal` abaixo e docs/auth-rbac.md, seção "Cadastro
// público". `companyId` continua com `input: true` porque o Better Auth
// roda a mesma validação de campos tanto para uma chamada HTTP quanto para
// uma chamada server-side via `auth.api.signUpEmail(...)` — `input: false`
// bloquearia até a nossa própria chamada confiável, não só a de um
// atacante.
const INTERNAL_SIGNUP_HEADER = "x-internal-signup-secret";

// Mesmo IP de `allowedDevOrigins` em next.config.ts — sem isso, o Better
// Auth rejeita com 403 "Missing or null Origin" qualquer requisição feita a
// partir do dev server acessado pelo IP da rede local (ex.: testando no
// celular), já que só confia por padrão na origem derivada de
// BETTER_AUTH_URL (http://localhost:3010). Ajuste/adicione o IP aqui junto
// com next.config.ts se ele mudar (DHCP).
const DEV_LAN_ORIGINS = ["http://192.168.1.239:3010"];

// `secret` (BETTER_AUTH_SECRET) e `baseURL` (BETTER_AUTH_URL) são lidos
// automaticamente das variáveis de ambiente pelo Better Auth.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: DEV_LAN_ORIGINS,
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      companyId: {
        type: "string",
        required: true,
        input: true,
      },
    },
  },
  advanced: {
    database: {
      // Deixa o Prisma gerar os ids (@default(cuid())), mantendo a mesma
      // estratégia de id usada em todo o resto do schema.
      generateId: false,
    },
  },
  hooks: {
    // Fecha a única brecha real de isolamento multi-tenant: sem este
    // bloqueio, qualquer cliente HTTP poderia chamar
    // POST /api/auth/sign-up/email diretamente com um `companyId` de uma
    // empresa alheia (já que o campo aceita `input: true`) e criar uma
    // conta dentro dela, ignorando por completo o fluxo controlado de
    // `app/api/register`. Bloqueando `/sign-up/email` para quem não
    // apresenta o header interno, a única forma de criar conta continua
    // sendo `/register` (que sempre cria uma Company nova, nunca aceita um
    // `companyId` existente do client).
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;

      const secret = process.env.BETTER_AUTH_SECRET;
      const provided = ctx.headers?.get(INTERNAL_SIGNUP_HEADER);
      if (!secret || provided !== secret) {
        throw new APIError("FORBIDDEN", {
          message: "Cadastro direto não permitido. Use a tela de registro.",
        });
      }
    }),
  },
  // nextCookies() precisa ser sempre o último plugin da lista.
  plugins: [nextCookies()],
});

/**
 * Único ponto que deve criar uma conta de verdade — sempre chamado a partir
 * de código server confiável (nunca exposto ao client): `app/api/register`
 * e `prisma/seed.ts`. Anexa o header interno que passa pelo gate em
 * `hooks.before` acima.
 */
export async function signUpEmailInternal(
  body: NonNullable<Parameters<typeof auth.api.signUpEmail>[0]>["body"],
  extraHeaders?: HeadersInit,
) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET não configurado — necessário para criar contas.");
  }

  const headers = new Headers(extraHeaders);
  headers.set(INTERNAL_SIGNUP_HEADER, secret);

  return auth.api.signUpEmail({ body, headers });
}
