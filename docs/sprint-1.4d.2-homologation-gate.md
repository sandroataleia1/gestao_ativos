# Gate de Homologação SST 1.4D.2 — Validação integrada, CSRF e liberação da base para notificações

Complementa `docs/sprint-1.4d.1-hardening.md` (hardening do Super Admin,
auditoria persistente). Este documento corrige a semântica operacional do
diagnóstico de exposição, prova a proteção CSRF por teste, e entrega o
checklist de homologação visual pronto para preenchimento pelo operador
humano (nenhum navegador foi acessado pelo agente que executou este gate).

## 1. Checkpoint

- Branch: `main`.
- Commit inicial deste gate: `6cd1a3d` (Sprint SST 1.4D.1).
- Working tree: limpo no início.
- Baseline: 471 testes passando, `migrate status` sem drift, typecheck e
  build limpos, nenhum segredo/dump encontrado.

## 2. Semântica final do diagnóstico (`diagnose:claim-flow-exposure`)

**Política adotada: A** (manter a auditoria persistente, corrigir a
descrição).

Descrição final, precisa: o diagnóstico **nunca altera dados de negócio**
(`Company`, `User`, `CompanyMembership`, `CompanyClaimRequest`,
`SstProviderCompany`, `UserRole`) — mas **não é estritamente "somente
leitura"**, porque cada execução persiste um evento append-only
(`platform_admin.exposure_diagnostic_executed`) em `PlatformAuditLog`. Essa
é, em si, a única escrita realizada.

Refatoração para tornar isso comprovável (não só afirmado): o núcleo do
diagnóstico foi extraído de `scripts/diagnose-claim-flow-exposure.ts` para
`lib/claim-exposure-diagnostic.ts` — duas funções:

- `runExposureDiagnosticQuery(since, until)` — 100% leitura (só
  `findMany`/`findFirst`/`findUnique`), consulta e classifica.
- `recordExposureDiagnosticExecuted(since, until)` — a ÚNICA escrita, um
  `PlatformAuditLog.create`.

Provado por `tests/tenant-isolation/claim-exposure-diagnostic.test.ts` (3
testes novos): roda as duas funções contra dados reais no banco de testes,
conta as 6 tabelas protegidas antes/depois, e confirma que só
`PlatformAuditLog` cresce.

Atualizado em consequência:
- Mensagens do CLI (`scripts/diagnose-claim-flow-exposure.ts`) — trocado
  "SOMENTE LEITURA" por "NÃO ALTERA DADOS DE NEGÓCIO", com a lista explícita
  das 6 tabelas e a menção à escrita append-only esperada.
- `docs/sprint-1.4d.1-hardening.md` §6 (checklist de validação manual, item
  "Diagnóstico de exposição") — descrição corrigida.
- Comentários do próprio script e do novo módulo `lib/claim-exposure-diagnostic.ts`.

## 3. Auditoria de CSRF (corrigida)

Ver `docs/sprint-1.4d.1-hardening.md`, seção 2 (reescrita nesta sprint) para
o texto completo. Resumo:

- A conclusão anterior ("SameSite=Lax sozinho resolve") foi substituída —
  não é mais aceita sem prova adicional.
- Confirmado que `originCheckMiddleware` do Better Auth só protege os
  próprios endpoints (`/api/auth/**`), nunca rotas customizadas que só
  chamam `getSession()`.
- Confirmado que não existe `middleware.ts`/proxy próprio validando
  Origin/Host (`proxy.ts` só faz rate limit + request-id).
- `disableCSRFCheck`/`disableOriginCheck`: **nunca habilitados** em nenhum
  ambiente (confirmado por grep em `lib/auth.ts` e todos os `.env*`).
- Cookie: `httpOnly: true`, `sameSite: "lax"`, `secure: IS_PRODUCTION`,
  `domain` não definido (mais restritivo possível — sem compartilhamento
  entre subdomínios).
- **Novo helper `lib/mutation-origin.ts` (`requireTrustedMutationOrigin`)**
  aplicado nas 3 rotas de escrita, como primeira linha de cada handler:
  valida `Sec-Fetch-Site`, `Origin` (allowlist exata) e `Host` (allowlist
  exata, nunca `X-Forwarded-Host`). Nunca cria token CSRF próprio.

## 4. Testes explícitos de CSRF

Adicionados em `tests/tenant-isolation/platform-admin.test.ts`, describe
`"CSRF — proteção de Origin/Host das rotas administrativas (Sprint SST 1.4D.2, §4)"`
— 8 cenários × 3 rotas (`start-review`/`approve`/`reject`) + 1 teste
estrutural, total 25 testes novos:

| # | Cenário | Resultado esperado | Status |
|---|---|---|---|
| 1 | Sessão ausente, Origin oficial | 401 (nunca 403 de origem) | ✅ |
| 2 | Sessão válida, Origin oficial | 200 | ✅ |
| 3 | Origin externo | 403 | ✅ |
| 4 | Origin com domínio semelhante (typosquat) | 403 | ✅ |
| 5 | Origin de subdomínio não autorizado | 403 | ✅ |
| 6 | Host incompatível | 403 | ✅ |
| 7 | `Sec-Fetch-Site: cross-site` | 403 | ✅ |
| 8 | Método inesperado | Estrutural: só `POST` é exportado (Next.js responde 405 automaticamente para os demais) | ✅ |
| 9 | Sem nenhum header de origem | 403 (fail-closed) | ✅ |
| 10 | Requisição legítima servidor-a-servidor | N/A — não existe esse caminho no projeto (documentado, não testado) | — |

Todos os 82 testes do arquivo passam (57 pré-existentes + 25 novos).

## 5. Resultado da homologação — checklist pronto para o operador

**Não executado neste gate** — requer navegador real, que o agente não tem
acesso. Preencher as tabelas abaixo durante a rodada de homologação.
Ambiente/usuário de teste sugeridos: `npm run dev` (porta 3010),
`admin@demo.com`/`Demo@12345` para o Portal Empresa onde aplicável, e um
Super Admin concedido via `platform-admin:grant` especificamente para esta
rodada.

### 5.1 Registro e claim

| Cenário | Aprovado/Reprovado | Horário | Usuário | Ambiente | Observação | Screenshot | Bug | Severidade |
|---|---|---|---|---|---|---|---|---|
| Company inexistente (CNPJ novo) | | | | | | | | |
| Company UNCLAIMED (pré-cadastrada por consultoria) | | | | | | | | |
| Company CLAIMED (já tem admin) | | | | | | | | |
| Claim PENDING (acompanhamento) | | | | | | | | |
| Claim DISPUTED (dois solicitantes) | | | | | | | | |
| Logout e novo login | | | | | | | | |
| Acesso direto bloqueado (URL direta sem sessão/claim) | | | | | | | | |
| Nenhuma associação prematura (sem membership antes da aprovação) | | | | | | | | |

### 5.2 Super Admin

| Cenário | Aprovado/Reprovado | Horário | Usuário | Ambiente | Observação | Screenshot | Bug | Severidade |
|---|---|---|---|---|---|---|---|---|
| Acesso negado para usuário comum | | | | | | | | |
| Grant do primeiro administrador (CLI) | | | | | | | | |
| Dashboard (`/platform-admin`) | | | | | | | | |
| Busca (nome/CNPJ/e-mail) | | | | | | | | |
| Filtros por status | | | | | | | | |
| Detalhe da claim | | | | | | | | |
| Iniciar análise | | | | | | | | |
| Justificativa inválida (vazia/curta/com segredo) | | | | | | | | |
| Aprovação | | | | | | | | |
| Rejeição | | | | | | | | |
| Disputa (duas claims, uma empresa) | | | | | | | | |
| Bloqueio de reatribuição (Super Admin B não assume silenciosamente) | | | | | | | | |
| Revogação durante sessão aberta | | | | | | | | |

### 5.3 Responsividade

| Viewport | Aprovado/Reprovado | Observação | Screenshot | Bug | Severidade |
|---|---|---|---|---|---|
| Desktop (≥1440px) | | | | | |
| Notebook (~1280px) | | | | | |
| Tablet (~768px) | | | | | |
| Mobile 375px — página de acompanhamento (`/company-claim/pending`) | | | | | |
| Ausência de overflow horizontal (todas as larguras) | | | | | |
| Diálogos acessíveis (foco, teclado, leitor de tela básico) | | | | | |
| Estados vazios (nenhuma claim, nenhum evento de auditoria) | | | | | |
| Feedback de erro visível (justificativa inválida, ação bloqueada) | | | | | |

## 6. Bugs encontrados e correções

Nenhum bug de produto foi encontrado nesta rodada (a homologação visual em
si está pendente de execução pelo operador — ver seção 5). As únicas
mudanças deste gate foram as comprovadas por auditoria/teste (CSRF ausente
nas rotas customizadas; descrição imprecisa do diagnóstico) — ambas
corrigidas com teste de regressão (seção 4 e `tests/tenant-isolation/claim-exposure-diagnostic.test.ts`).

Se a homologação visual (seção 5) encontrar bugs, registrar aqui antes de
corrigir, e adicionar teste de regressão para cada correção — nunca
redesign amplo, nova arquitetura ou nova funcionalidade neste gate.

## 7. Decisão sobre MFA

Mantida a decisão da Sprint SST 1.4D.1 (`docs/sprint-1.4d.1-hardening.md`,
seção 3) — não implementado, não revisitado neste gate (fora de escopo por
instrução explícita).

- **Homologação interna**: liberada, com conta exclusiva, senha forte,
  sessão restrita, acesso limitado, auditoria (`/platform-admin/audit`) e
  revogação imediata disponível.
- **Produção com clientes reais**: bloqueada até MFA compatível com Better
  Auth, ou reautenticação forte para aprovação/rejeição, ou decisão formal
  de risco aprovada pelo responsável da plataforma.

## 8. Matriz GO/NO-GO

| Decisão | Status | Motivo |
|---|---|---|
| Sprint SST 1.4E (notificações) | **GO** | Base técnica (auditoria persistente, CSRF comprovado, diagnóstico corrigido) está pronta; notificações são um domínio novo e independente. |
| Homologação interna do Super Admin | **GO** | Mitigações da seção 7 suficientes para uso interno controlado; CSRF agora comprovado por teste. |
| Implantação em produção | **NO-GO** | Homologação visual (seção 5) ainda não executada por um operador humano — pré-requisito explícito do spec original (§14 da Sprint 1.4D.1) nunca satisfeito. |
| Liberação do registro público | **NO-GO** | Depende da mesma validação manual pendente (fluxo de claim ponta a ponta nunca confirmado em navegador real) — sem isso não há evidência de que o fluxo de reivindicação funciona para um usuário real. |
| Uso do Super Admin com empresas reais | **NO-GO** | Bloqueado por MFA ausente (seção 7) E pela homologação visual pendente — os dois precisam ser resolvidos antes de qualquer empresa real passar por aprovação/rejeição administrativa. |

Nenhum item foi marcado GO sem evidência: Sprint 1.4E e homologação interna
se apoiam em testes automatizados específicos (82 testes de
platform-admin, 3 de diagnóstico) executados nesta sessão; os NO-GO
apontam exatamente a evidência que falta (validação manual em navegador,
MFA).

## 9. Testes finais, typecheck, build, migrate status

Ver relatório de entrega (resposta da sessão) para os números exatos após
todas as mudanças deste gate.

## 10. Riscos remanescentes

- Validação manual em navegador real segue pendente — nenhuma sprint desde
  a 1.4D conseguiu executá-la (o agente não tem acesso a navegador).
- MFA/reautenticação seguem ausentes (risco já classificado, sem mudança
  neste gate).
- Reatribuição explícita de análise entre Super Admins continua bloqueada
  (não implementada), por decisão da Sprint 1.4D.1 preservada aqui.
- O item 10 do checklist de CSRF ("requisição legítima servidor-a-servidor")
  não tem teste correspondente porque não existe esse caminho hoje — se um
  dia existir (ex.: um worker/job chamando estas rotas via HTTP), precisa de
  um mecanismo de autenticação de serviço explícito (mesmo padrão do header
  interno `x-internal-signup-secret` de `lib/auth.ts`), nunca uma exceção
  silenciosa em `requireTrustedMutationOrigin`.
