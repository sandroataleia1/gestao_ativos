# Sprint SST 1.4D.1 — Hardening do Super Admin, auditoria persistente e gate de implantação

Complementa `docs/deploy-checklist.md`/`docs/deployment.md` (checklist genérico
de deploy) e `docs/homologation.md` (homologação manual geral) com as
conclusões e o gate ESPECÍFICOS desta sprint. Ler antes de qualquer deploy das
Sprints SST 1.4A–1.4D.1 (nenhuma foi implantada até esta sprint).

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

## 2. CSRF

**Conclusão: mitigado pela configuração de cookie já existente — nenhuma
mudança de código foi necessária nesta sprint.**

`lib/auth.ts` já configura `advanced.defaultCookieAttributes.sameSite: "lax"`
para o cookie de sessão do Better Auth (`httpOnly: true` também). Como as 3
rotas de escrita de `/api/platform-admin/**` (e todas as outras rotas
autenticadas por cookie do projeto) dependem exclusivamente desse cookie de
sessão via `requireAuth()`/`requirePlatformRole()`, uma requisição `POST`
disparada a partir de um site de terceiros (formulário HTML, `fetch`
cross-origin, ou a técnica de enctype `text/plain` para simular JSON) NUNCA
inclui o cookie de sessão — `SameSite=Lax` só permite o envio do cookie em
navegação de nível superior via `GET`, nunca em `POST` cross-site. A
requisição forjada chega sem sessão e é rejeitada com 401 antes de qualquer
lógica de negócio rodar.

Isso torna uma camada adicional de validação de `Origin`/`Host` redundante
para esta sprint — adicioná-la seria complexidade sem ganho de segurança
real. Se no futuro o projeto passar a aceitar autenticação por outro meio
que não dependa de cookie `SameSite=Lax` (ex.: token em header controlado
pelo client, aceito também via cookie legado), esta conclusão precisa ser
revisada.

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
4. Rodar com janela válida → confirmar execução somente-leitura e a janela
   impressa corretamente.
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
