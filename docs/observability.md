# Observabilidade

Este documento cobre logging estruturado, request id/correlation id, trilha
de auditoria (`AuditLog`), health check e métricas — a base de
observabilidade construída em cima do que já existia (`lib/monitoring.ts`
para Sentry, `app/api/health` para health check, `lib/audit.ts`/`AuditLog`
para ações de usuário).

## 1. Logging estruturado (`lib/logger.ts`)

Instância `pino` (JSON, timestamp ISO, nível via `LOG_LEVEL` — default
`info`). `pino` é o padrão de fato em Node/Next.js: rápido, sem
dependências pesadas, em vez de um formatter caseiro.

```ts
import { logInfo, logWarn, logError } from "@/lib/logger";

logInfo("algo aconteceu", { chave: "valor" });
```

Cada chamada já anexa automaticamente `requestId`/`correlationId` da
requisição atual (ver seção 2) — não precisa passar isso manualmente.

`lib/api-errors.ts` usa `logError` no fallback de erro não mapeado (500
genérico), substituindo o `console.error` solto que existia antes — mesma
informação, agora estruturada e correlacionável a uma requisição.

## 2. Request id e correlation id (`proxy.ts`)

`proxy.ts` (Next 16 — renomeação de `middleware.ts`, roda em runtime
Node.js) gera, para **toda** requisição (exceto assets estáticos):

- `X-Request-Id`: sempre novo, `crypto.randomUUID()`.
- `X-Correlation-Id`: reaproveita o header `X-Correlation-Id` do client se
  ele mandar um (útil pra encadear várias requisições da mesma operação
  lógica); senão, cai no próprio request id.

Os dois são propagados como header de **request** (Route
Handlers/Server Components leem via `next/headers()`, ver
`lib/logger.ts` `getRequestContext()`) e devolvidos como header de
**resposta** — o client pode usar `X-Request-Id` pra referenciar num
report de erro e cruzar com o log do servidor.

**Limitação assumida**: `proxy.ts` intercepta a requisição *antes* dela
chegar na rota — não é um proxy reverso de verdade, então não vê o status
HTTP nem a duração da resposta final. Por isso não há métrica de
latência/status por rota nesta entrega (instrumentar as 40+ rotas
existentes uma a uma ficou fora de escopo). Fica como melhoria futura.

## 3. AuditLog (`lib/audit.ts`)

`logAudit(tx, {...})` grava uma linha em `AuditLog` (companyId, ator,
ação, tipo/id/rótulo do alvo, metadados) **dentro da mesma transação** da
operação real — se a operação for revertida, o log também é. Além de
gravar no banco, cada chamada:

- Emite uma linha de log estruturado (`lib/logger.ts`).
- Incrementa a métrica `audit_events_total{action}` (`lib/metrics.ts`).
- Grava `requestId`/`correlationId` automaticamente (colunas nullable —
  cruza a linha de auditoria com o log estruturado da mesma requisição).

`tx` pode ser um `Prisma.TransactionClient` de verdade, ou o `prisma`
singleton diretamente para eventos sem transação natural (login/logout) —
`PrismaClient` satisfaz a mesma interface estruturalmente.

### Ações registradas

| Ação | Onde | Alvo |
|---|---|---|
| `auth.login` | `lib/auth.ts` (hook `after` de `/sign-in/email`) | Usuário que logou |
| `auth.logout` | `lib/auth.ts` (hook `before` de `/sign-out`) | Usuário que saiu |
| `custody.deliver` | `app/api/custodies/deliver/route.ts` | `AssetCustody` criada |
| `custody.return` | `app/api/custodies/return/route.ts` | `AssetCustody` devolvida |
| `asset.delete` | `app/api/assets/[id]/route.ts` (`DELETE`) | Ativo desativado |
| `employee.delete` | `app/api/employees/[id]/route.ts` (`DELETE`) | Colaborador desativado |
| `import.run` | `app/api/imports/confirm/route.ts` | Resumo da importação (nunca dado de linha) |
| `user.create`/`invite`/`update_profile`/`block`/`unblock`/`password_reset_link`/`delete` | `app/api/company/users/**` | Usuário afetado (já existia, ver docs/auth-rbac.md) |

### Login/logout — como foi resolvido sem depender de internals do Better Auth

- **Login**: hook `after` casando `/sign-in/email` lê `ctx.context.returned`
  (mesmo campo que o plugin oficial `nextCookies()` já usa — parte estável
  do contrato de hook, não um acesso interno) pra extrair o usuário logado.
- **Logout**: hook `before` casando `/sign-out` chama `auth.api.getSession`
  (API pública, a mesma usada em `lib/auth-server.ts`) pra resolver quem
  está saindo **antes** da sessão ser destruída — não tenta ler o cookie de
  sessão manualmente (a função que faz isso, `getSessionFromCtx`, é interna
  e não exportada pelo Better Auth).

## 4. Health check (`GET /api/health`)

Já existente (sprint de hardening); sem sessão, pra ferramentas de
monitoramento externo. Retorna status do banco, versão, uptime e
timestamp; agora também atualiza o gauge `health_check_status`
(`lib/metrics.ts`) a cada chamada.

## 5. Métricas (`GET /api/metrics`, `lib/metrics.ts`)

`prom-client` (cliente Prometheus padrão pra Node) expõe métricas em
formato de exposição do Prometheus:

- Métricas padrão de processo via `collectDefaultMetrics()` (memória, CPU,
  event loop lag) — de graça.
- `audit_events_total{action}` (Counter) — volume de eventos de auditoria.
- `health_check_status` (Gauge) — 1 = ok, 0 = degradado.

Protegido por `METRICS_TOKEN` (opcional): se configurado, exige
`Authorization: Bearer <token>` (o `scrape_configs` do Prometheus suporta
isso nativamente). Sem o token configurado, o endpoint fica aberto —
recomenda-se então restringir por rede/nginx em produção.

## 6. Nunca registrar dado sensível — checklist

Ao adicionar um novo `logAudit`/log estruturado, **nunca** incluir:

- Senha (nem hash).
- Token de sessão ou de redefinição de senha.
- Documento completo (CPF/CNPJ) de colaborador ou empresa.
- Corpo bruto de request/response.

O que já é aceito (e usado nos exemplos acima): nome, e-mail (mesmo padrão
já usado no `targetLabel` de usuário), ids internos (`cuid`, não
sequenciais), contagens agregadas (resumo de importação), papel/role.
