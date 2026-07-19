# Setup — primeiro acesso ao ambiente demo

Como preparar um ambiente local (ou uma instância recém-implantada) para o
primeiro acesso, e quais credenciais demo já vêm prontas depois de rodar o
seed.

## 1. Rodar o seed

```bash
npm run db:seed
```

Idempotente — pode rodar quantas vezes quiser, nunca duplica dados. Cria a
empresa demo, os usuários demo por papel, o catálogo de modelos de
treinamento e dois prestadores SST demo (ver `prisma/seed.ts`).

Se já existirem dados de teste acumulados e você quiser voltar a um estado
limpo (mantendo a empresa/usuários, só apagando o que o uso diário
acumulou), use `npm run db:reset-demo` em vez disso — ver
`docs/homologation.md`.

## 2. Portal Empresa — acesso à "Empresa Demo"

URL de login: `/login`

| Papel | Email | Senha |
|---|---|---|
| Admin | `admin@demo.com` | `Demo@12345` |
| RH | `rh@demo.com` | `Demo@12345` |
| Almoxarifado | `almoxarifado@demo.com` | `Demo@12345` |
| Consulta | `consulta@demo.com` | `Demo@12345` |

Todos pertencem à mesma empresa ("Empresa Demo"), cada um com o papel
correspondente já atribuído — use um usuário de papel específico para testar
o comportamento de RBAC daquele papel (ver `docs/auth-rbac.md`) sem precisar
criar contas manualmente.

## 3. Portal Consultoria SST — acesso demo

URL de login: `/sst/login`

| Consultoria | Email | Senha |
|---|---|---|
| Consultoria Segura SST (papel OWNER) | `sst@demo.com` | `Demo@12345` |

Este prestador já tem um vínculo `ACTIVE`/`ADMINISTRATION` com a "Empresa
Demo" — ao entrar, a empresa já aparece disponível para gestão pelo portal.

## 4. Portal Administração da Plataforma (Super Admin)

URL: `/platform-admin` (login continua sendo `/login`, o mesmo do Portal
Empresa — o Super Admin é um papel adicional sobre um usuário Better Auth já
existente, não um login separado).

**Não existe super admin seedado automaticamente, de propósito.** O módulo
que concede esse papel (`lib/platform-admin-bootstrap.ts`) é explícito
sobre isso: só conhecer um e-mail/senha nunca deve bastar para administrar
a plataforma inteira (todas as empresas, não só uma), e como `prisma db
seed` roda automaticamente no primeiro deploy em produção
(`docs/deployment.md`), qualquer credencial fixa colocada ali ficaria
disponível em qualquer ambiente onde o seed rodasse — inclusive produção
real. A concessão é sempre um passo manual, deliberado, contra um usuário
que já existe.

Para promover o admin da empresa demo a Super Admin (primeiro bootstrap —
só funciona se ainda não existir nenhum Super Admin ativo no banco):

```bash
npm run platform-admin:grant -- --email=admin@demo.com \
  --confirm-first-bootstrap --reason="Setup do ambiente demo"
```

Depois disso, `admin@demo.com` / `Demo@12345` acessa tanto o Portal Empresa
quanto `/platform-admin` (mesma sessão, mesmo login).

Concessões seguintes (depois que já existe pelo menos um Super Admin ativo)
exigem `--granted-by=email-do-super-admin-responsavel` em vez de
`--confirm-first-bootstrap` — ver o cabeçalho de
`scripts/platform-admin-grant.ts` para o fluxo completo, e
`scripts/platform-admin-revoke.ts` para revogar.

## 5. Variáveis de ambiente necessárias

Ver `docs/homologation.md`, seção "Variáveis de ambiente necessárias"
(`DATABASE_URL`, `BETTER_AUTH_SECRET`).

## Ver também

- `docs/homologation.md` — reset de dados demo e checklist de rodada de
  testes manuais.
- `docs/deployment.md` — deploy em produção (Docker/VPS).
- `docs/auth-rbac.md` — papéis e permissões do Portal Empresa.
