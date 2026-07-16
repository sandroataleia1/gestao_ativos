# Sprint SST 1.4D.1 — Hardening do Super Admin, auditoria persistente e gate de implantação

Complementa `docs/deploy-checklist.md`/`docs/deployment.md` (checklist genérico
de deploy) e `docs/homologation.md` (homologação manual geral) com as
conclusões e o gate ESPECÍFICOS desta sprint. Ler antes de qualquer deploy das
Sprints SST 1.4A–1.4D.1 (nenhuma foi implantada até esta sprint).

> **Atualizado pela Sprint SST 1.4D.2** (`docs/sprint-1.4d.2-homologation-gate.md`):
> a seção 2 (CSRF) abaixo foi corrigida/substituída — a conclusão original
> ("SameSite=Lax sozinho resolve") estava incompleta. A seção 5 (plano de
> implantação) também foi ajustada quanto à descrição do diagnóstico de
> exposição (nunca é "somente leitura" — ver `docs/sprint-1.4d.2-homologation-gate.md`,
> §2). Ler os dois documentos juntos antes de qualquer deploy.

## 1. Proteção das rotas administrativas (`app/api/platform-admin/**`)

Únicas 3 rotas existentes nesta sprint:

- `POST /api/platform-admin/company-claims/[id]/start-review`
- `POST /api/platform-admin/company-claims/[id]/approve`
- `POST /api/platform-admin/company-claims/[id]/reject`

Confirmado por leitura de código + testes (`tests/tenant-isolation/platform-admin.test.ts`,
itens 39/40/44/45/46/52/53 e "Concorrência real" item 4):

- Todos os métodos de escrita são `POST` (padrão do projeto).
- `requirePlatformRole("SUPER_ADMIN")` roda no servidor em toda rota, e
  também no `layout.tsx` de `/platform-admin/**` (Server Component) —
  esconder o menu nunca é o guard, só a UI.
- `PlatformUser.active` é reconsultado a cada chamada (nunca cacheado na
  sessão) — revogar durante uma sessão aberta bloqueia a PRÓXIMA ação, sem
  exigir logout (teste 52 e "Concorrência real" item 4).
- Nenhuma autorização depende da UI, de `CompanyMembership`, de
  `SstProviderUser`, de um `companyId` vindo do navegador, ou de uma role
  enviada pelo client — `lib/platform-auth.ts` nunca consulta nenhuma dessas
  fontes.
- Nenhuma rota interna aceita `reviewedByUserId`, `companyId`,
  `requesterUserId`, `roleId`, `controlStatus`, `accessLevel` ou
  `authorizationBasis` do corpo da requisição — os schemas Zod
  (`lib/validations/platform-admin.ts`) só reconhecem `reviewNote`/
  `verificationMethod`; qualquer campo extra é silenciosamente ignorado
  (teste 38).
- Nenhuma rota permite alteração direta de status fora dos serviços de
  domínio (`lib/company-claim-request.ts`, `lib/platform-admin-claims.ts`).
- Erros do Prisma nunca vazam — `handleApiError` (`lib/api-errors.ts`) sempre
  devolve uma mensagem classificada; o catch-all final é
  `"Erro interno do servidor."` genérico (teste 53).
- As respostas de todas as 3 rotas nunca incluem dados operacionais de
  clientes (colaboradores, treinamentos, ativos, documentos) — o shape de
  retorno (`ClaimDetailForAdmin`/`ClaimListItem`) não tem esses campos.

**Conclusão: a proteção das rotas administrativas críticas está adequada.**

## 2. CSRF (revisado e comprovado por teste na Sprint SST 1.4D.2)

**A conclusão da Sprint SST 1.4D.1 ("SameSite=Lax sozinho resolve") estava
incompleta e foi corrigida nesta sprint.** `SameSite=Lax` continua sendo uma
mitigação real, mas descansar só nela é um único ponto de falha sem nenhuma
corroboração do lado do servidor — o gate de homologação 1.4D.2 pediu
explicitamente para não aceitar essa conclusão sem prova.

**Auditoria de como a sessão é resolvida nestas rotas:** as 3 rotas de
`app/api/platform-admin/**` são Route Handlers customizados do Next.js —
elas chamam `requirePlatformRole()` → `requireAuth()` → `auth.api.getSession()`
para ler a sessão do cookie, mas NUNCA passam pelo `auth.handler` do Better
Auth (o catch-all montado só em `/api/auth/**`). Isso importa porque o
`originCheckMiddleware`/`validateOrigin` nativo do Better Auth
(`node_modules/better-auth/dist/api/middlewares/origin-check.mjs`) é
middleware do PRÓPRIO pipeline de endpoints do Better Auth — só roda para
requisições que o `auth.handler` processa diretamente. Rotas customizadas
que só chamam `getSession()` para ler a sessão NUNCA passam por esse
middleware. Confirmado também que este projeto não tem `middleware.ts`
fazendo essa validação — `proxy.ts` (o `middleware.ts` renomeado no Next.js
16) só faz rate limiting e propagação de request-id, nada de Origin/Host.

**Conclusão: antes desta sprint, a proteção CSRF real dessas 3 rotas era
100% dependente do atributo `SameSite=Lax` do cookie — nenhuma validação de
Origin/Host do lado do servidor existia. Corrigido nesta sprint**, com uma
segunda camada de defesa: `lib/mutation-origin.ts` (`requireTrustedMutationOrigin`),
chamado como a PRIMEIRA linha de cada uma das 3 rotas, antes de qualquer
leitura de sessão/banco.

Configuração auditada explicitamente (checklist do gate):

| Item | Valor | Onde |
|---|---|---|
| `disableCSRFCheck` | não definido (default `false`) | `lib/auth.ts` |
| `disableOriginCheck` | não definido (default `false`, exceto em ambiente de teste, comportamento padrão da lib) | `lib/auth.ts` |
| `trustedOrigins` (Better Auth) | `DEV_LAN_ORIGINS` (só o IP de LAN de dev) — usado só pelos endpoints do PRÓPRIO Better Auth | `lib/auth.ts` |
| `sameSite` do cookie | `"lax"`, explícito | `lib/auth.ts`, `advanced.defaultCookieAttributes` |
| `secure` do cookie | `IS_PRODUCTION` (`true` em produção, via `useSecureCookies`) | `lib/auth.ts` |
| `httpOnly` do cookie | `true` | `lib/auth.ts` |
| `domain` do cookie | não definido (nenhum valor explícito) — o mais restritivo possível: o navegador escopa ao host exato, nunca compartilha entre subdomínios | `lib/auth.ts` |
| Middleware/proxy próprio validando Origin/Host | Não existia antes desta sprint; agora existe via `lib/mutation-origin.ts`, aplicado nas 3 rotas | `proxy.ts` (rate limit only), `lib/mutation-origin.ts` (novo) |

`disableCSRFCheck`/`disableOriginCheck` **nunca estão habilitados** em
nenhum ambiente deste projeto (não aparecem em nenhum `.env*`, nem como
`true` em `lib/auth.ts`) — confirmado por `grep`.

### `requireTrustedMutationOrigin` (novo, `lib/mutation-origin.ts`)

Chamado como primeira linha de cada rota (`start-review`/`approve`/`reject`).
Regras, nesta ordem:

1. `Sec-Fetch-Site: cross-site` → rejeita (403) incondicionalmente — sinal
   de Fetch Metadata enviado pelo navegador, não falsificável por
   JavaScript da página.
2. `Origin` ausente → rejeita (política fail-closed: uma chamada real de
   navegador para estas rotas sempre envia `Origin` em POST, mesmo
   same-origin; não existe hoje nenhuma chamada legítima servidor-a-servidor
   para estas rotas).
3. `Origin` presente mas fora da allowlist (`BETTER_AUTH_URL` + origem de
   LAN de dev) → rejeita.
4. `Host` presente mas fora da allowlist → rejeita. Nunca lê
   `X-Forwarded-Host` (o `nginx/conf.d/patrium.conf` deste projeto nunca o
   define — só `Host: $host`, `X-Real-IP`, `X-Forwarded-For`,
   `X-Forwarded-Proto` — confiar nesse header seria aceitar um valor
   forjável por qualquer cliente direto).

Comparação sempre por IGUALDADE EXATA (nunca `startsWith`/`endsWith`) —
evita domínio parecido (`patrium-esis.com.br`) ou subdomínio não autorizado
(`evil.patrium.esis.com.br`) passarem por um checagem de prefixo/sufixo mal
feita. Nunca cria um token CSRF próprio — só valida Origin/Host contra a
mesma fonte de verdade (`BETTER_AUTH_URL`) já usada pelo Better Auth.

A política preserva: navegador real (Origin/Host sempre batem em uso
normal), testes (helper `jsonRequest` em
`tests/tenant-isolation/platform-admin.test.ts` usa a mesma origem
confiável por default), proxy reverso em produção (Host vem de
`nginx/conf.d/patrium.conf`, que sempre repassa o domínio real), e
desenvolvimento local/LAN (`DEV_LAN_ORIGINS`, reaproveitado de
`lib/dev-lan-origins.ts`).

## 3. Autenticação forte / reautenticação (MFA)

**Conclusão: NÃO implementado — bloqueador explícito para uso com clientes
reais. Portal Super Admin Lite autorizado apenas para homologação interna
nesta sprint.**

Levantamento do estado atual (`lib/auth.ts`):

- Política de senha: Better Auth `emailAndPassword` habilitado: sem MFA,
  usa somente e-mail+senha padrão do Better Auth (comprimento mínimo padrão
  da lib, aplicado no cadastro `app/register`).
- Verificação de e-mail: `emailVerified` existe no schema mas não há fluxo
  ativo de confirmação de e-mail no cadastro público.
- Expiração de sessão: `session.expiresIn = 7 dias`, `updateAge = 1 dia`
  (rotação) — declarados explicitamente, adequados para o portal cliente,
  mas SEM nenhuma expiração mais curta específica para o Portal Super Admin.
- Revogação de sessão: `revokeSessionsOnPasswordReset: true` — troca de
  senha já invalida sessões antigas.
- MFA: **não configurado**. Better Auth suporta um plugin `twoFactor`, mas
  ele não está instalado nem habilitado neste projeto (`grep` confirmado —
  nenhuma referência a `twoFactor`/TOTP em `lib/auth.ts` ou `package.json`).
- Reautenticação por ação crítica: **não existe** nenhum mecanismo de
  "confirme sua senha antes de aprovar/rejeitar/conceder/revogar".
- Rate limit de login / força bruta: `rateLimit` nativo do Better Auth está
  habilitado (`window: 60s, max: 30`), e o próprio Better Auth já aplica uma
  regra interna mais estrita a `/sign-in/email` (janela 10s / máx. 3).

Por que isso NÃO foi implementado nesta sprint: adicionar MFA/reautenticação
de verdade exige escolher e instalar um plugin novo (`twoFactor` do Better
Auth ou equivalente), desenhar o fluxo de enrollment, e decidir se vira
obrigatório para todo `PlatformUser` — mudança de escopo amplo, fora do que
esta sprint de hardening pontual deveria absorver, e explicitamente vedada
pelo spec ("nunca implementar autenticação paralela").

**Mitigação recomendada até uma sprint dedicada a isso:**

1. Conta de Super Admin exclusiva, nunca compartilhada com uma conta
   operacional do dia a dia.
2. Senha forte e única (gerenciador de senhas), trocada periodicamente.
3. Acesso operacional (máquina/rede) restrito a quem realmente precisa
   revisar reivindicações.
4. Revisar `/platform-admin/audit` regularmente em busca de
   `platform_admin.unauthorized_access_attempt` ou acessos em horários
   incomuns.
5. Nunca aprovar reivindicações fora de um canal de verificação humana
   (contato telefônico/documentação) — o campo `reviewNote` já exige isso.

**Esta sprint não pode ser declarada "Super Admin completamente
endurecido"** — aprovar/rejeitar uma reivindicação concede administração
total de uma empresa, e isso continua protegido apenas por sessão de
e-mail+senha sem MFA.

## 4. Busca do Super Admin (CNPJ/e-mail)

Página `/platform-admin/company-claims` (`app/platform-admin/company-claims/page.tsx`):

- Protegida pelo mesmo `requirePlatformRoleOrDeny("SUPER_ADMIN")` do layout
  — só `PlatformUser` ativo acessa (nenhuma rota de busca separada e
  pública).
- CNPJ e e-mail nunca aparecem integrais na listagem (`maskCnpjForLog`/
  `maskEmail` em `lib/platform-admin-listing.ts`).
- Nenhum valor completo é escrito em log (buscas são resolvidas via
  Server Component, sem log de query de busca).
- Paginação server-side (`pageSize` limitado a 100).
- Não existe exportação em massa nem endpoint de autocomplete público — a
  busca só existe embutida na página SSR protegida, não como API JSON
  chamável diretamente por um client não autenticado.
- Rate limit dedicado não foi adicionado à busca em si: como a única
  superfície é a própria página SSR (já atrás do guard de sessão +
  `PlatformUser.active`), o risco de abuso é o de um Super Admin já
  autorizado, não de um atacante externo — mesma lógica de por que
  `lib/rate-limit.ts` hoje só protege rotas públicas (`/api/register`,
  `/q/[token]`, `/assinar/[token]`).

**Conclusão: adequado para esta sprint — nenhuma mudança de código
necessária.**

## 5. Plano de implantação corrigido

Erro do plano anterior (Sprint SST 1.4D): usava o timestamp do NOVO deploy
seguro como início da janela de exposição analisada por
`diagnose:claim-flow-exposure` — isso ignoraria todo o período real em que
o commit vulnerável `42fc120` esteve em produção.

Fluxo corrigido (nunca fazer deploy sem seguir esta ordem):

1. Backup de produção.
2. Identificar o timestamp REAL (ou o limite mais antigo plausível e
   conservador, documentado como tal) em que o commit `42fc120` entrou em
   produção — consultar logs do PM2/systemd/CI-CD, histórico de shell, Git
   reflog do servidor, observabilidade, ou registro operacional.
3. Registrar esse valor como `CLAIM_EXPOSURE_START_AT` (início real da
   exposição — NUNCA o timestamp do novo deploy).
4. Colocar `/register` em manutenção, se necessário, para o deploy.
5. `npx prisma migrate deploy` (todas as migrations, incluindo
   `20260715195256_platform_audit_log` desta sprint).
6. Conceder o primeiro `PlatformUser` real via
   `npm run platform-admin:grant -- --email=... --confirm-first-bootstrap --reason="..."`.
7. Deploy atômico do HEAD final (código seguro).
8. Registrar o horário exato em que o código seguro entrou no ar — este é
   o `CLAIM_EXPOSURE_END_AT`.
9. Executar:
   ```
   CLAIM_EXPOSURE_START_AT="<deploy real de 42fc120>" \
   CLAIM_EXPOSURE_END_AT="<deploy do código seguro>" \
   npm run diagnose:claim-flow-exposure
   ```
10. Revisar manualmente todos os registros na seção "SUSPEITA"/"REVISAR" —
    nunca revogar automaticamente.
11. Executar `npm run diagnose:pending-claim-user-company` e
    `npm run diagnose:company-documents`.
12. Validar manualmente (ver checklist §6 abaixo): registro, claim
    pendente, Super Admin, aprovação, rejeição, acesso bloqueado.
13. Monitorar `company_claim.*` e `platform_admin.*` (structured logs +
    `/platform-admin/audit`) nas horas seguintes.
14. Retirar o modo de manutenção só depois do smoke test.
15. Documentar a implantação (data/hora, quem executou, resultado do
    diagnóstico de exposição, quaisquer registros sinalizados para revisão).

**Nunca usar o timestamp do novo deploy como início da exposição.**

## 6. Checklist de validação manual (operador humano — navegador real)

Esta sprint não pode ser aprovada para deploy sem esta validação executada
por um operador humano com navegador real (o agente que implementou esta
sprint não tem acesso a navegador). Preencher e anexar ao registro da
implantação: resultado, screenshots, horário, usuário de teste, ambiente.

### Usuário sem PlatformUser
1. Login.
2. Abrir `/platform-admin` → confirmar bloqueio (redirect/forbidden).
3. Chamar uma das 3 APIs internas diretamente (ex.: `curl` com o cookie de
   sessão) → confirmar 403.
4. Confirmar que não há dado do Portal Super Admin no HTML inicial.

### Super Admin ativo
1. Conceder acesso pelo CLI (`platform-admin:grant`).
2. Login.
3. Abrir dashboard (`/platform-admin`).
4. Listar claims (`/platform-admin/company-claims`).
5. Buscar por nome/CNPJ/e-mail.
6. Filtrar por status.
7. Abrir detalhe de uma claim.
8. Iniciar análise.
9. Tentar aprovar sem justificativa (ou justificativa curta demais) →
   confirmar bloqueio.
10. Aprovar com justificativa válida.
11. Confirmar membership criada (Portal Empresa do solicitante).
12. Confirmar que o solicitante está liberado.

### Rejeição
1. Abrir outra claim.
2. Rejeitar com justificativa.
3. Confirmar ausência de membership.
4. Confirmar estado refletido na página `/company-claim/pending` do
   solicitante.

### Disputa
1. Criar duas claims para a mesma Company (dois usuários).
2. Confirmar `controlStatus: DISPUTED`.
3. Aprovar uma.
4. Confirmar só uma membership administrativa resultante.
5. Confirmar que a outra claim foi encerrada (REJECTED,
   "SUPERSEDED_BY_APPROVAL").

### Revogação do Super Admin
1. Manter a sessão aberta (não fazer logout).
2. Revogar o `PlatformUser` (CLI, de outro terminal/operador).
3. Tentar nova ação administrativa na sessão ainda aberta.
4. Confirmar bloqueio imediato (403), sem precisar de logout.
5. Confirmar evento persistente (`platform_admin.access_revoked`) em
   `/platform-admin/audit`.

### Reatribuição (comportamento endurecido nesta sprint)
1. Super Admin A inicia análise de uma claim.
2. Super Admin B abre a mesma claim e tenta iniciar análise.
3. Confirmar que B recebe erro (nunca assume a claim silenciosamente) —
   nesta sprint a reatribuição explícita NÃO está implementada (decisão
   documentada no spec: bloquear e deixar para evolução futura).
4. Confirmar evento `platform_admin.claim_review_reassignment_blocked`
   auditado com o revisor anterior (A) e o que tentou (B).

### Diagnóstico de exposição
1. Rodar sem parâmetros → confirmar falha segura (sem consultar o banco).
2. Rodar só com início → confirmar falha.
3. Rodar só com fim → confirmar falha.
4. Rodar com janela válida → confirmar que a janela é impressa corretamente
   e que NENHUM dado de negócio (Company/User/CompanyMembership/
   CompanyClaimRequest/SstProviderCompany/UserRole) é alterado — a única
   escrita esperada é o INSERT append-only em `PlatformAuditLog` (ver
   correção de nomenclatura na Sprint SST 1.4D.2, §2: este script nunca foi
   estritamente "somente leitura" desde que passou a auditar sua própria
   execução).
5. Confirmar evento `platform_admin.exposure_diagnostic_executed` em
   `/platform-admin/audit`.

## 7. Riscos remanescentes (registrar explicitamente)

- MFA/reautenticação ausente (§3) — aprovar/rejeitar concede administração
  total de uma empresa protegida só por e-mail+senha.
- Identificação do ator no CLI (`--granted-by`/e-mail) não é
  criptograficamente forte — é uma alegação de quem está no terminal, não
  uma prova de identidade.
- Reatribuição explícita de análise entre Super Admins não está
  implementada (bloqueada, não resolvida) — se isso se tornar uma
  necessidade operacional real, precisa de uma sprint dedicada (ação
  específica "Reatribuir análise", com confirmação e justificativa).
- `/platform-admin/audit` não tem paginação de altíssimo volume otimizada
  (ex.: cursor-based) — adequado para o volume esperado desta fase
  (plataforma pré-lançamento, 0 `PlatformUser`/`CompanyClaimRequest` hoje),
  mas deve ser revisitado se o volume de eventos crescer muito.
