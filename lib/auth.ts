import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { logAudit } from "@/lib/audit";
import { resolveUnambiguousCompany } from "@/lib/company-context";
import { DEV_LAN_ORIGINS } from "@/lib/dev-lan-origins";
// `logger` (pino cru), NUNCA `logInfo`/`logWarn` de lib/logger.ts aqui — esses
// dois chamam `next/headers()` internamente para propagar request-id, o que
// os hooks do Better Auth não podem depender (rodam fora de um request scope
// de Server Component/Route Handler — ver Sprint 0.5, Parte F).
import { logger } from "@/lib/logger";

// Header interno que só o próprio servidor pode enviar (nunca alcançável a
// partir de um POST externo direto a /api/auth/sign-up/email) — ver
// `signUpEmailInternal` abaixo e docs/auth-rbac.md, seção "Cadastro
// público". `companyId` continua com `input: true` porque o Better Auth
// roda a mesma validação de campos tanto para uma chamada HTTP quanto para
// uma chamada server-side via `auth.api.signUpEmail(...)` — `input: false`
// bloquearia até a nossa própria chamada confiável, não só a de um
// atacante.
const INTERNAL_SIGNUP_HEADER = "x-internal-signup-secret";

// DEV_LAN_ORIGINS agora vive em lib/dev-lan-origins.ts (Sprint SST 1.4D.2)
// — reaproveitado também por lib/mutation-origin.ts, que não pode importar
// deste módulo (lib/auth.ts é mockado inteiro em vários testes).

// Só esses hops são confiáveis para "desembrulhar" X-Forwarded-For (ver
// advanced.ipAddress.trustedProxies abaixo). Sem isso, um client que envie
// o próprio header X-Forwarded-For forjado com vários IPs faria o Better
// Auth cair no bucket compartilhado "sem IP confiável" em vez de
// identificar corretamente o IP real por trás do nginx.
//
// - 127.0.0.1/::1: topologia antiga (nginx instalado direto no host,
//   reencaminhando pro processo Node via loopback).
// - 172.28.0.10: container do nginx no docker-compose.prod.yml — IP fixo
//   atribuído a ele na rede `patrium_net` (ver `nginx.networks.patrium_net.
//   ipv4_address` nesse arquivo). Só o nginx tem esse IP fixo nessa rede;
//   nenhum outro container/host externo consegue assumi-lo.
const TRUSTED_PROXIES = ["127.0.0.1", "::1", "172.28.0.10"];

// Explícito em vez de deixar a lib inferir pelo protocolo/URL (instrução do
// hardening: "não depender apenas dos defaults"). Não pode ser `true` fixo,
// porque isso quebraria o teste em celular pela rede local (DEV_LAN_ORIGINS
// acima) — o navegador não envia cookie `Secure` de volta para um origin
// http:// que não seja localhost, e o LAN IP é servido em http simples em
// dev. Em produção (`patrium.esis.com.br`) sempre roda atrás de HTTPS via
// nginx/certbot, então força sempre seguro ali.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Capturado pelo `sendResetPassword` abaixo para o fluxo admin-triggered
// (`generatePasswordResetLink`, usado em convite/redefinição a partir de
// /configuracoes/usuarios) — o mesmo callback também dispara o e-mail de
// verdade (ver abaixo) para o fluxo self-service ("esqueci minha senha",
// /esqueci-senha). Só é seguro capturar num módulo-level assim para
// chamadas sequenciais disparadas por uma ação administrativa (que sempre
// aguarda a resposta antes de prosseguir) — o fluxo self-service não lê
// essa variável, só depende do e-mail enviado. Como `runInBackgroundOrAwait`
// (node_modules/better-auth/dist/context/create-context.mjs) sempre aguarda
// este callback quando `advanced.backgroundTasks.handler` não está
// configurado (não está), `generatePasswordResetLink` pode ler esta
// variável logo depois do `await auth.api.requestPasswordReset(...)` com
// segurança.
let lastPasswordResetToken: { email: string; token: string } | null = null;

// `secret` (BETTER_AUTH_SECRET) e `baseURL` (BETTER_AUTH_URL) são lidos
// automaticamente das variáveis de ambiente pelo Better Auth.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: DEV_LAN_ORIGINS,
  emailAndPassword: {
    enabled: true,
    // Explícito em vez do default de 1h — mesmo valor, mas declarado (ver
    // instrução geral do hardening: "não depender apenas dos defaults").
    resetPasswordTokenExpiresIn: 60 * 60,
    // Ao redefinir a senha (self-service ou via link admin), invalida
    // qualquer sessão aberta anteriormente — evita que uma sessão obtida
    // antes de uma possível invasão de conta continue válida depois da
    // troca de senha. Default do Better Auth é `false`.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      lastPasswordResetToken = { email: user.email, token };

      const link = `${process.env.BETTER_AUTH_URL ?? ""}/redefinir-senha/${token}`;
      // `sendMail` nunca lança (falha de SMTP vira log/monitoramento
      // internamente, ver lib/mail.ts) — este callback nunca derruba
      // `requestPasswordReset` mesmo se o envio de e-mail falhar.
      await sendMail({
        to: user.email,
        subject: "Redefinição de senha — Gestão de Ativos",
        html: `
          <p>Olá, ${user.name}.</p>
          <p>Recebemos um pedido para redefinir a senha da sua conta. Clique no link abaixo para escolher uma nova senha (válido por 1 hora):</p>
          <p><a href="${link}">${link}</a></p>
          <p>Se você não pediu isso, pode ignorar este e-mail com segurança — sua senha atual continua válida.</p>
        `,
        text: `Redefinição de senha — acesse o link para escolher uma nova senha (válido por 1 hora): ${link}\n\nSe você não pediu isso, ignore este e-mail.`,
      });
    },
  },
  user: {
    additionalFields: {
      // Sprint SST 1.4C.1 — deixou de ser obrigatório: desde a Sprint SST
      // 1.4C, um usuário recém-registrado não tem mais nenhuma Company
      // "sua" até que uma CompanyClaimRequest seja aprovada
      // (lib/company-claim-request.ts:approveCompanyClaimRequest, único
      // lugar que agora preenche esta coluna). Continua só uma preferência
      // legada — nunca autorização (ver lib/company-context.ts) — mas
      // "preferência ausente" precisa ser um estado real e representável
      // (null), não mais forçado a apontar para uma empresa que o usuário
      // ainda não administra.
      companyId: {
        type: "string",
        required: false,
        input: true,
      },
      // Coluna `User.active` já existe no schema (default true) mas nunca
      // tinha sido exposta ao Better Auth — sem isso, `session.user.active`
      // não aparece no objeto de sessão. `input: false`: nunca setável pelo
      // próprio usuário (só por uma rota admin, via Prisma direto). Ver
      // checagem em `lib/auth-server.ts` (`getCurrentUser`).
      active: {
        type: "boolean",
        required: false,
        input: false,
      },
    },
  },
  // Sprint de hardening de segurança: duração/rotação de sessão e rate
  // limiting explícitos, não deixados no default da biblioteca.
  session: {
    // 7 dias — mesmo valor do default do Better Auth, mas declarado
    // explicitamente para não depender de uma mudança de default numa
    // atualização futura da lib.
    expiresIn: 60 * 60 * 24 * 7,
    // A cada login/uso a sessão é renovada (rotação) se tiver passado mais
    // de 1 dia desde a última renovação — evita forçar login diário sem
    // deixar uma sessão de 7 dias completamente estática.
    updateAge: 60 * 60 * 24,
  },
  // Rate limiting nativo do Better Auth (cobre /sign-in/email,
  // /sign-up/email, /request-password-reset, /reset-password — os
  // endpoints já existem no handler mesmo sem UI de "esqueci a senha"
  // ainda). Por padrão só liga em produção (`NODE_ENV`); aqui fica
  // explícito para não depender dessa detecção implícita. Login/cadastro
  // já ganham automaticamente uma regra interna mais estrita
  // (janela 10s/máx. 3) e recuperação de senha (janela 60s/máx. 3) — ver
  // node_modules/better-auth/dist/api/rate-limiter/index.mjs
  // `getDefaultSpecialRules()`. As demais rotas do Better Auth caem na
  // regra geral abaixo.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    storage: "memory",
  },
  advanced: {
    database: {
      // Deixa o Prisma gerar os ids (@default(cuid())), mantendo a mesma
      // estratégia de id usada em todo o resto do schema.
      generateId: false,
    },
    ipAddress: {
      trustedProxies: TRUSTED_PROXIES,
    },
    useSecureCookies: IS_PRODUCTION,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Fecha a única brecha real de isolamento multi-tenant: sem este
      // bloqueio, qualquer cliente HTTP poderia chamar
      // POST /api/auth/sign-up/email diretamente com um `companyId` de uma
      // empresa alheia (já que o campo aceita `input: true`) e criar uma
      // conta dentro dela, ignorando por completo o fluxo controlado de
      // `app/api/register`. Bloqueando `/sign-up/email` para quem não
      // apresenta o header interno, a única forma de criar conta continua
      // sendo `/register` (que sempre cria uma Company nova, nunca aceita um
      // `companyId` existente do client).
      if (ctx.path === "/sign-up/email") {
        const secret = process.env.BETTER_AUTH_SECRET;
        const provided = ctx.headers?.get(INTERNAL_SIGNUP_HEADER);
        if (!secret || provided !== secret) {
          throw new APIError("FORBIDDEN", {
            message: "Cadastro direto não permitido. Use a tela de registro.",
          });
        }
        return;
      }

      // Observabilidade (docs/observability.md): loga o logout ANTES da
      // sessão ser destruída — depois de `/sign-out` rodar não há mais
      // como saber quem era. Usa `auth.api.getSession` (API pública, a
      // mesma que `lib/auth-server.ts` usa) em vez de tentar ler o cookie
      // de sessão manualmente dentro do hook — a função que faz isso
      // internamente (`getSessionFromCtx`) não é exportada pelo Better
      // Auth, então acoplar a ela seria depender de um caminho interno
      // instável da lib.
      //
      // Sprint 0.6, Parte A.1: qual `companyId` usar na linha de auditoria
      // vem de `resolveUnambiguousCompany()` (lib/company-context.ts), NUNCA
      // duplicado aqui. Diferente de `resolveCompanyContext()` (usado para
      // servir página/API), esta variante NUNCA prioriza `User.companyId` —
      // só grava `AuditLog` empresarial quando o usuário tem exatamente UMA
      // membership ACTIVE com empresa disponível; com zero ou várias, só
      // log estruturado, nunca atribuição arbitrária à empresa legada.
      if (ctx.path === "/sign-out") {
        const session = await auth.api.getSession({ headers: ctx.headers ?? new Headers() }).catch(() => null);
        if (session?.user) {
          const user = session.user as typeof session.user & { companyId: string };
          const result = await resolveUnambiguousCompany(user.id);
          if (result.status === "RESOLVED") {
            await logAudit(prisma, {
              companyId: result.companyId,
              actorUserId: user.id,
              actorName: user.name,
              action: "auth.logout",
              targetType: "User",
              targetId: user.id,
            });
          } else {
            // NONE ou AMBIGUOUS — AuditLog.companyId é obrigatório e nunca
            // deve ser uma escolha arbitrária; registra só a ocorrência em
            // log estruturado (sem e-mail/CPF/CNPJ/cookie/token).
            logger.warn({ userId: user.id, resolveStatus: result.status }, "auth_hook_logout_no_unambiguous_company");
          }
        }
      }
    }),
    // Observabilidade: loga o login com sucesso. `ctx.context.returned` é o
    // mesmo campo que o próprio plugin oficial `nextCookies()` já lê (ver
    // node_modules/better-auth/dist/utils/plugin-helper.mjs) — parte
    // estável do contrato de hook do framework, não um acesso interno.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;

      const returned = ctx.context.returned;
      if (!returned) return;
      const body = returned instanceof Response ? (returned.status === 200 ? await returned.clone().json() : null) : returned;
      const user = (body as { user?: { id: string; name: string; email: string; companyId?: string } } | null)?.user;
      if (!user?.id) return;

      const result = await resolveUnambiguousCompany(user.id);
      if (result.status === "RESOLVED") {
        await logAudit(prisma, {
          companyId: result.companyId,
          actorUserId: user.id,
          actorName: user.name,
          action: "auth.login",
          targetType: "User",
          targetId: user.id,
        });
      } else {
        logger.warn({ userId: user.id, resolveStatus: result.status }, "auth_hook_login_no_unambiguous_company");
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

/**
 * Roda uma chamada de `auth.api` (ex.: `signUpEmailInternal`) sem deixar o
 * cookie de sessão do admin autenticado ser substituído pela sessão do
 * usuário recém-criado. Necessário porque o plugin `nextCookies()` (ver
 * `plugins` acima) intercepta o Set-Cookie de **qualquer** chamada de
 * `auth.api` feita dentro de uma Route Handler e aplica automaticamente via
 * `next/headers()` — inclusive quando um ADMIN cria outro usuário a partir
 * de app/(app)/configuracoes/usuarios, o que sem isso desconectaria o
 * admin e o logaria como o usuário que ele acabou de criar. Não é um
 * problema em `app/api/register` porque ali não existe sessão anterior
 * para preservar (o próprio cadastro é quem deve logar).
 */
export async function withoutSessionCookieSideEffects<T>(fn: () => Promise<T>): Promise<T> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const before = new Map(cookieStore.getAll().map((cookie) => [cookie.name, cookie.value]));

  const result = await fn();

  for (const cookie of cookieStore.getAll()) {
    const originalValue = before.get(cookie.name);
    if (originalValue === undefined) {
      // Cookie novo, introduzido pela chamada (ex.: sessão do usuário
      // recém-criado) — não deve vazar para a resposta do admin.
      cookieStore.delete(cookie.name);
    } else if (cookie.value !== originalValue) {
      cookieStore.set(cookie.name, originalValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: IS_PRODUCTION,
        path: "/",
      });
    }
  }

  return result;
}

/**
 * Gera um link de definição de senha reaproveitando o endpoint oficial de
 * reset do Better Auth (`/request-password-reset` + `/reset-password`) —
 * sem enviar e-mail nenhum, já que não há serviço de e-mail configurado.
 * Usado tanto para convidar um usuário novo (senha inicial é um placeholder
 * aleatório que nunca é usado) quanto para redefinir a senha de um usuário
 * existente a pedido de um admin. Quem chama esta função é responsável por
 * exibir o link para o admin compartilhar manualmente (WhatsApp, etc.).
 */
export async function generatePasswordResetLink(email: string): Promise<string> {
  lastPasswordResetToken = null;
  await auth.api.requestPasswordReset({ body: { email } });

  // TS não consegue rastrear que `sendResetPassword` (chamado dentro do
  // `await` acima) reatribui essa variável de módulo, então acha que ela
  // continua `null` daqui pra frente — captura numa `const` própria pra
  // sair desse (falso) estreitamento de tipo.
  const captured = lastPasswordResetToken as { email: string; token: string } | null;
  if (!captured || captured.email !== email) {
    throw new Error("Não foi possível gerar o link de redefinição de senha.");
  }

  const { token } = captured;
  lastPasswordResetToken = null;

  const baseUrl = process.env.BETTER_AUTH_URL ?? "";
  return `${baseUrl}/redefinir-senha/${token}`;
}
