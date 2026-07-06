# Autenticação, usuários e RBAC

Este documento explica a base de autenticação e autorização do projeto:
[Better Auth](https://www.better-auth.com/) para autenticação, e um RBAC
próprio (não o plugin de organização do Better Auth) para autorização
multi-tenant, construído sobre a entidade `Company` já existente.

## 1. Como a autenticação funciona

- **Biblioteca:** `better-auth` (v1.6.x), com o adapter oficial do Prisma
  (`better-auth/adapters/prisma`), usando o `prisma` singleton de
  `lib/prisma.ts` (Prisma 7 + `@prisma/adapter-pg`).
- **Instância server-side:** `lib/auth.ts` exporta `auth = betterAuth({...})`.
  - `emailAndPassword.enabled: true` — login por email/senha (sem provedores
    sociais configurados por enquanto).
  - `user.additionalFields.companyId` — registra o campo `companyId` (obrigatório)
    no schema de usuário do Better Auth, para que ele seja aceito no cadastro
    e devolvido na sessão.
  - `advanced.database.generateId: false` — desliga o gerador de id interno
    do Better Auth; o Postgres/Prisma gera os ids via `@default(cuid())`,
    mesma estratégia usada em todas as outras tabelas do domínio.
  - `plugins: [nextCookies()]` — grava a sessão em cookies no App Router.
- **Rota HTTP:** `app/api/auth/[...all]/route.ts` expõe todos os endpoints do
  Better Auth (`/api/auth/sign-in/email`, `/api/auth/sign-up/email`,
  `/api/auth/sign-out`, `/api/auth/get-session`, etc.) via
  `toNextJsHandler(auth)`.
- **Variáveis de ambiente** (`.env`, ver `.env.example`):
  - `BETTER_AUTH_SECRET` — chave usada para assinar sessões/tokens. Gerar com:
    `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
  - `BETTER_AUTH_URL` — URL base da aplicação (`http://localhost:3000` em dev).
- **Tabelas** (`prisma/schema.prisma`): `User`, `Session`, `Account`,
  `Verification` — nomes e campos seguem exatamente o que o adapter Prisma
  do Better Auth espera. `User` foi estendido com `companyId` (FK obrigatória
  para `Company`) e `active`.

Não há UI de login incluída nesta etapa — apenas a infraestrutura de
back-end. Uma tela de login pode chamar os endpoints REST acima diretamente,
ou usar `better-auth/react` (`createAuthClient`) no client, ainda não
adicionado ao projeto.

### Cadastro público — por que `/api/auth/sign-up/email` é bloqueado

Auditoria do MVP encontrou uma brecha real: como `companyId` é um campo
`input: true` (precisa ser aceito no cadastro para que o Better Auth grave o
tenant do novo usuário), **qualquer cliente HTTP podia chamar
`POST /api/auth/sign-up/email` diretamente**, informando o `companyId` de
uma empresa alheia — criando uma conta *dentro* daquele tenant, sem passar
pelo fluxo controlado de `app/api/register`.

A correção (`lib/auth.ts`) usa um `hooks.before` do Better Auth que rejeita
qualquer chamada a `/sign-up/email` sem um header interno
(`x-internal-signup-secret`, igual a `BETTER_AUTH_SECRET`) — header que só
o próprio código do servidor consegue enviar, nunca um request externo.
`companyId` continua `input: true` (não dá para trocar para `input: false`:
o Better Auth valida os campos do mesmo jeito para uma chamada HTTP e para
uma chamada server-side via `auth.api.signUpEmail(...)`, então `input:
false` bloquearia até a nossa própria chamada confiável).

Na prática:

- A única forma de criar uma conta continua sendo `POST /api/register`
  (usado pela tela `/register`), que **sempre** cria uma `Company` nova
  (`prisma.company.create`) — nunca aceita nem reaproveita um `companyId`
  vindo do client. Isso não mudou.
- `app/api/register/route.ts` e `prisma/seed.ts` chamam
  `signUpEmailInternal(body, extraHeaders?)` (exportado de `lib/auth.ts`) em
  vez de `auth.api.signUpEmail` diretamente — esse helper injeta o header
  interno automaticamente.
- Um POST direto a `/api/auth/sign-up/email` (sem passar pelo `/register`)
  agora sempre recebe `403 FORBIDDEN`, em qualquer ambiente — não há
  distinção dev/produção: o cadastro público continua igual em ambos, só o
  atalho direto ao endpoint interno do Better Auth é que fica fechado.

## 2. Como o tenant (empresa) é resolvido

- Todo `User` pertence a exatamente uma `Company` (`User.companyId`,
  obrigatório). Esse vínculo é definido no momento do cadastro (passando
  `companyId` no corpo de `POST /api/auth/sign-up/email`) e passa a fazer
  parte da sessão retornada pelo Better Auth.
- **O tenant nunca é lido de input do client** (body, query string, header
  arbitrário). Ele é sempre derivado da sessão autenticada, através de
  `getCurrentCompany()` / `requireCompany()` (`lib/auth-server.ts`).
- Consequência prática: nenhuma Server Action, Route Handler ou Server
  Component deve aceitar um `companyId` vindo do client para decidir *quais
  dados* retornar ou alterar. O `companyId` usado em `where: { companyId }`
  deve sempre vir de `requireCompany()`.

## 3. Como o RBAC funciona

O Better Auth cuida só de "quem é o usuário". Quem pode fazer o quê é
resolvido por um RBAC próprio, com 4 tabelas em `prisma/schema.prisma`:

| Tabela | O que representa |
|---|---|
| `Role` | Papel, parametrizável **por empresa** (`companyId`), igual a `AssetStatus`/`AssetCondition`. `@@unique([companyId, name])`. |
| `Permission` | Catálogo **global** de capacidades do código (ex.: `asset:manage`, `stock:view`). Não é por empresa — é fixo, definido em `lib/permissions.ts`. |
| `RolePermission` | Join N:N entre `Role` e `Permission`. |
| `UserRole` | Atribui um `Role` a um `User` **dentro de uma `Company`**. Um usuário pode ter mais de um papel na mesma empresa (`@@unique([userId, roleId])`, sem limitar a um único papel). |

### Papéis padrão (seed)

Criados pelo seed como `isSystem: true` na empresa demo, mas o modelo permite
que cada empresa crie papéis adicionais no futuro:

| Papel | Foco |
|---|---|
| `ADMIN` | Acesso total, incluindo gestão de usuários/papéis |
| `GESTOR` | Gestão operacional completa de ativos, sem administrar usuários |
| `RH` | Custódia e movimentação de ativos ligados a colaboradores |
| `ALMOXARIFADO` | Estoque, unidades de ativos e localizações |
| `TECNICO_SST` | Controle de EPIs / ativos de segurança do trabalho |
| `CONSULTA` | Somente leitura em todo o domínio |

O mapeamento papel → permissões default está em
`lib/permissions.ts` (`DEFAULT_ROLE_PERMISSIONS`) e é aplicado pelo seed —
é só um ponto de partida; como `Role`/`RolePermission` são dados normais,
qualquer empresa pode ganhar uma UI de administração para customizá-los sem
alterar código.

### Catálogo de permissões

Definido em `lib/permissions.ts` (`PERMISSIONS`), agrupado por recurso do
domínio: `asset:*`, `asset_unit:*`, `location:*`, `category:manage`,
`manufacturer:manage`, `supplier:manage`, `movement:*`, `custody:*`,
`stock:*`, `user:manage`, `role:manage`. Ver o arquivo para a lista completa
com descrições.

## 4. Como proteger rotas e APIs

Helpers server-side em `lib/auth-server.ts` (uso em Server Components, Route
Handlers e Server Actions — nunca em Client Components):

```ts
import {
  getCurrentUser,
  getCurrentCompany,
  requireAuth,
  requireCompany,
  requireRole,
  requirePermission,
} from "@/lib/auth-server";
```

- `getCurrentUser()` — usuário da sessão atual, ou `null`.
- `getCurrentCompany()` — `Company` do usuário atual, ou `null`.
- `requireAuth()` — retorna o usuário autenticado ou lança `AuthError`
  (trate como 401).
- `requireCompany()` — retorna `{ user, companyId }` com o tenant já
  resolvido da sessão; use esse `companyId` em toda query de negócio.
- `requireRole(role)` — garante que o usuário tem um papel específico
  (ex.: `SYSTEM_ROLES.ADMIN` de `lib/permissions.ts`) dentro da empresa atual.
- `requirePermission(permission)` — garante que algum papel do usuário,
  dentro da empresa atual, tem a permissão informada (ex.:
  `PERMISSIONS.ASSET_MANAGE`). É o helper recomendado para proteger ações de
  negócio — prefira permissões a papéis fixos sempre que possível, para não
  acoplar código ao nome exato do papel.

Ambos `requireRole`/`requirePermission` lançam `ForbiddenError` (trate como
403) quando a checagem falha.

### Exemplo — Route Handler

```ts
// app/api/assets/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET() {
  const { companyId } = await requirePermission(PERMISSIONS.ASSET_VIEW);

  const assets = await prisma.asset.findMany({ where: { companyId } });
  return NextResponse.json(assets);
}
```

### Exemplo — Server Component

```tsx
// app/(app)/assets/page.tsx
import { requireCompany } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

export default async function AssetsPage() {
  const { companyId } = await requireCompany();
  const assets = await prisma.asset.findMany({ where: { companyId } });
  return <AssetsTable assets={assets} />;
}
```

### Isolamento multi-tenant — checklist

- Nunca aceitar `companyId` do body/query/params do client em uma query de
  leitura ou escrita de dados de negócio; sempre usar o `companyId` de
  `requireCompany()`/`requirePermission()`.
- Toda query Prisma sobre entidades de negócio (`Asset`, `AssetUnit`,
  `AssetMovement`, `StockBalance`, etc.) deve incluir `companyId` no `where`.
- Ao criar registros relacionados (ex.: `AssetUnit` a partir de um `Asset`),
  usar o `companyId` já resolvido, nunca o que vier em `req.body`.
- `requireRole`/`requirePermission` já garantem isso para as ações que
  protegem — mas rotas de leitura simples que só chamam `requireCompany()`
  também precisam lembrar de filtrar por `companyId`.

## 5. Seed (`prisma/seed.ts`)

Idempotente — pode ser rodado várias vezes sem duplicar dados (usa
`upsert`/checagem por email antes de criar). Cria:

- Uma `Company` demo ("Empresa Demo").
- Todas as `Permission`s do catálogo de `lib/permissions.ts` (a lista cresce
  conforme novos módulos ganham permissão própria — ver `PERMISSIONS` no
  arquivo para a contagem atual).
- Os 6 `Role`s padrão, vinculados à empresa demo.
- Os vínculos `RolePermission` conforme `DEFAULT_ROLE_PERMISSIONS`.
- Um usuário admin demo (`admin@demo.com` / `Demo@12345`), criado via
  `auth.api.signUpEmail(...)` (para que a senha seja hasheada exatamente como
  o Better Auth espera) e associado ao papel `ADMIN`.

Rodar com:

```bash
npm run db:seed
# equivalente a `prisma db seed`, que por sua vez roda o comando
# configurado em `migrations.seed` no prisma.config.ts (`tsx prisma/seed.ts`)
```

`prisma migrate reset` também dispara o seed automaticamente.
