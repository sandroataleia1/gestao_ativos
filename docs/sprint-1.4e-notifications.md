# Sprint SST 1.4E — Centro de notificações compartilhado

Domínio único de notificações reutilizado pelos três portais (Empresa,
Consultoria SST, Super Admin). Complementa (nunca substitui) `AuditLog`,
`PlatformAuditLog` e a página de alertas operacionais existente.

## 1. Auditoria inicial — pontos de evento mapeados

| Responsabilidade | Arquivo | Evento que gera notificação |
|---|---|---|
| Topbar Portal Empresa | `components/layout/header.tsx` (via `app/(app)/layout.tsx`) | Sino instalado aqui |
| Topbar Portal Consultoria | `app/sst/(portal)/layout.tsx` | Sino instalado aqui |
| Header Portal Super Admin | `app/platform-admin/layout.tsx` | Sino instalado aqui |
| Página de alertas operacionais | `app/(app)/alerts/page.tsx` | Fora de escopo — não tocado |
| Solicitação de acesso a empresa existente | `lib/sst-company-provisioning.ts` (`continueWithExistingCompany`, chamado por `requestAccessToCompany`) | `COMPANY_SST_ACCESS_REQUESTED` |
| Pré-cadastro de empresa nova | `lib/sst-company-provisioning.ts` (`preRegisterCompany`) | Nenhuma (ninguém para receber ainda) |
| Aprovação/Recusa/Suspensão/Revogação/Nível | `lib/sst-providers.ts` (`updateProviderLinkStatus`) | `SST_ACCESS_APPROVED`/`REJECTED`/`SUSPENDED`/`REVOKED`/`LEVEL_CHANGED` + resolve `COMPANY_SST_ACCESS_REQUESTED` |
| Reivindicação criada/reaberta | `lib/company-claim-request.ts` (`createOrReuseClaimRequest`) | `PLATFORM_COMPANY_CLAIM_REQUESTED` (+ `SST_COMPANY_CLAIM_STARTED` se pré-cadastro) |
| Empresa em disputa | `lib/company-claim-request.ts` (mesma função, transição para `DISPUTED`) | `PLATFORM_COMPANY_CLAIM_DISPUTED` |
| Aprovação/rejeição da claim | `lib/company-claim-request.ts` (`approveCompanyClaimRequest`/`rejectCompanyClaimRequest`) | Resolve `PLATFORM_COMPANY_CLAIM_REQUESTED` (+ `DISPUTED` na aprovação) |
| Decisão CONTINUE/BLOCK | `lib/company-claim.ts` (`resolveClaimDecision`) | `SST_AUTHORIZATION_CONFIRMED`/`BLOCKED` + resolve `SST_COMPANY_CLAIM_STARTED` |
| Proteção de origem | `lib/mutation-origin.ts` | Reaproveitado (Sprint 1.4D.2) em todas as 15 rotas POST novas |
| Paginação | `lib/pagination.ts` | Padrão reaproveitado nas 3 APIs de listagem |
| Auth helpers | `lib/auth-server.ts`, `lib/sst-auth.ts`, `lib/platform-auth.ts` | Reaproveitados sem alteração |

## 2. Alerta vs. auditoria vs. notificação

- **Alerta operacional** (estoque, CA, custódia, treinamento): situação atual do domínio, regras próprias já existentes — **não tocado nesta sprint**.
- **Auditoria** (`AuditLog`/`PlatformAuditLog`): histórico técnico/administrativo — continua sendo a fonte de verdade para "quem fez o quê, quando".
- **Notificação** (`Notification`/`NotificationReceipt`, novo): mensagem visível a um público autorizado, nunca fonte de autorização, nunca substitui os dois acima.

## 3-4. Schema e invariantes

Ver `prisma/schema.prisma` (modelos `Notification`/`NotificationReceipt`, enums `NotificationAudience`/`NotificationSeverity`/`NotificationType`) e a migration
`prisma/migrations/20260716124922_notifications/migration.sql`.

Invariantes garantidos em duas camadas:
1. **Aplicação** (`lib/notifications.ts:assertAudienceScope`) — valida antes de qualquer INSERT.
2. **Banco** (CHECK constraint `notification_audience_scope_check`, adicionada manualmente à migration — o Prisma não expressa "campo obrigatório condicionado ao valor de um enum" declarativamente): garante a mesma regra mesmo contra um INSERT bruto fora da aplicação.

A migration é puramente aditiva: 2 tabelas novas, 3 enums novos, FKs `Restrict` para `Company`/`SstProvider` (nunca hard-deletados hoje), `Cascade` para `User` em `NotificationReceipt` (perder o usuário não deve deixar receipt órfão). Nenhuma tabela existente foi alterada. Aplicada em dev e no banco de testes; `prisma migrate status` sem drift.

**Estratégia de backfill**: nenhuma (§29 do spec — decisão deliberada). A migration começa vazia; só eventos novos, a partir do deploy, passam a notificar. Documentado como limitação conhecida, não como bug.

**Rollback**: `prisma migrate resolve --rolled-back` + `DROP TABLE "NotificationReceipt", "Notification"; DROP TYPE "NotificationAudience", "NotificationSeverity", "NotificationType";` — seguro porque nenhuma outra tabela referencia `Notification`/`NotificationReceipt` (só o inverso).

## 5. Política de visibilidade

`lib/notifications-visibility.ts:getNotificationVisibilityPolicy(type)` — fixa em código, nunca client-supplied. Cada tipo define audiência, severidade, se aparece no sino, se permanece após resolução, se exige contexto de empresa ativa (+ permissão), papéis SST que enxergam (matriz OWNER/TECHNICIAN/VIEWER do §7, implementada exatamente como especificada), e o `actionKey` default.

**Decisão de design**: `pendingVia` (`RESOLUTION` vs `READ`) — eventos que exigem uma decisão (`COMPANY_SST_ACCESS_REQUESTED`, `SST_COMPANY_CLAIM_STARTED`, `PLATFORM_COMPANY_CLAIM_REQUESTED`, `PLATFORM_COMPANY_CLAIM_DISPUTED`) contam para o badge via `resolvedAt` (global); os demais (informativos: aprovado/rejeitado/suspenso/revogado/nível alterado/confirmado/bloqueado) contam via `readAt` individual. Isso implementa literalmente a distinção do spec §1 ("leitura individual, resolução global") sem ambiguidade.

## 6. Serviço central e dedupe

`lib/notifications.ts:createNotification` — valida escopo, sanitiza (`assertNoSecrets`, reaproveitado de `lib/platform-audit.ts`), e é idempotente por `(audience, dedupeKey)`.

**Bug encontrado e corrigido durante os testes**: a implementação original tentava `create` e capturava `P2002` para reler a linha existente. Isso funciona com o cliente `prisma` de topo, mas **quebra dentro de uma transação interativa** (`tx` de um serviço de domínio) — no Postgres, qualquer erro dentro de uma transação a aborta inteiramente; comandos subsequentes (mesmo um `findUniqueOrThrow` de recuperação) falham com `current transaction is aborted`. Corrigido para SEMPRE checar (`findUnique`) antes de tentar criar — elimina o erro no caso comum (retry esperado, ex.: reabertura de uma `CompanyClaimRequest`); só uma corrida genuína entre duas transações simultâneas ainda pode gerar `P2002`, e nesse caso (dentro de uma transação de chamador) o erro é propagado de propósito — mesma filosofia de `ConflictError` já usada em todo o projeto para corridas (o chamador falha e trata/repete a operação inteira). Coberto por `tests/tenant-isolation/company-claim-request.test.ts` (teste pré-existente que expôs o bug) e pelo teste de concorrência dedicado em `tests/tenant-isolation/notifications.test.ts`.

`dedupeKey` sempre construída a partir de um identificador estável da transição (`relationshipId`, `claimRequestId`, `link.updatedAt`/`company.updatedAt`/`claim.requestedAt` como versão) — nunca timestamp aleatório.

## 7. Eventos de domínio (transacionais)

Todos os `notify*`/`resolveNotification*` são chamados DENTRO da mesma transação Prisma da alteração de domínio (`lib/sst-providers.ts`, `lib/sst-company-provisioning.ts`, `lib/company-claim-request.ts`, `lib/company-claim.ts`) — uma falha da transação nunca deixa uma notificação órfã (testado explicitamente).

**Extensão mínima necessária**: `SST_ACCESS_LEVEL_CHANGED` não tinha nenhum gatilho real no código antes desta sprint (o nível só mudava como efeito colateral da aprovação PENDING→ACTIVE). Adicionada uma transição `ACTIVE → ACTIVE` (troca de nível pura) em `ALLOWED_STATUS_TRANSITIONS` (`lib/sst-providers.ts`) — extensão de uma linha da mesma tabela de transições já existente (mesmo espírito de `SUSPENDED → ACTIVE`), nunca uma reaprovação silenciosa (rejeitada se o nível não mudar de fato).

**Decisão documentada**: `requestAccessToCompany` nunca cria `COMPANY_SST_ACCESS_REQUESTED` se a Company ainda não tiver nenhuma `CompanyMembership` ACTIVE (nenhum usuário empresarial existe para receber) — nem essa notificação nem um evento de plataforma substituto (não é um evento de reivindicação). A solicitação continua visível normalmente na tela de prestadores assim que a empresa tiver um administrador; só a notificação em si é adiada.

## 8. Resolução e receipts

`resolveNotificationByDedupeKey`/`resolveNotificationsForEntity` (`lib/notifications.ts`) — `resolvedAt` nunca remove, nunca marca como lida para ninguém, nunca apaga receipts. `NotificationReceipt` (`lib/notifications-receipts.ts`) é sempre individual: `markNotificationRead` (idempotente, revalida visibilidade primeiro — 404 sem revelar existência), `markAllNotificationsRead` (1 select + 1 createMany + 1 updateMany, nunca 1 query por notificação — **segundo bug encontrado e corrigido**: a primeira versão criava os receipts já com `readAt` preenchido, fazendo o `updateMany` seguinte não encontrar nada para atualizar e retornar sempre `count: 0`; corrigido para criar sem `readAt` e deixar o `updateMany` ser a única fonte da contagem real), `dismissNotification` (nunca resolve globalmente, nunca afeta outro usuário).

## 9. APIs (15 rotas)

5 endpoints × 3 portais, todas seguindo o mesmo contrato: `GET` (lista + `?view=bell` + `?category=`), `GET /unread-count`, `POST /[id]/read`, `POST /read-all`, `POST /[id]/dismiss`. Nenhuma rota genérica aceita `audience`/`companyId`/`sstProviderId`/`userId` do navegador — sempre resolvidos da sessão (`requireCompany()`/`requireSstAuth()`/`requirePlatformRole()`). `requireTrustedMutationOrigin` (Sprint 1.4D.2) aplicado como primeira linha de todas as 9 rotas `POST`.

## 10. Sinos e páginas

`components/notifications/notification-bell.tsx` (compartilhado, parametrizado por `apiBase`/`historyHref`/`triggerClassName`) instalado nos 3 headers. `components/notifications/notifications-page-client.tsx` (compartilhado) usado pelas 3 páginas completas (`/notifications`, `/sst/notifications`, `/platform-admin/notifications`), com abas de categoria por portal.

Usa `DropdownMenu` (não `Popover`/`ScrollArea` — nenhum dos dois existe neste projeto; reaproveitado o overlay acessível já usado em `UserMenu` em vez de adicionar uma biblioteca nova só para o sino, conforme §24 do spec).

## 11. actionKey e navegação segura

`lib/notification-action.ts:resolveNotificationAction` — nunca gera URL para `actionKey` desconhecido ou fora do portal do contexto. `href` é resolvido no SERVIDOR (`lib/notifications-client-dto.ts`) antes de qualquer resposta chegar ao client — o client nunca recebe `actionKey`/`metadata` brutos, só a URL final (ou `null`). A autorização real acontece sempre na rota de destino (guards já existentes), nunca no resolver.

## 12. Atualização do contador

Carregamento inicial + ao abrir o popover + após read/read-all + ao voltar o foco da janela + polling a cada 45s (nunca abaixo de 30s) — nenhum WebSocket/SSE, nenhuma biblioteca nova.

## 13. Acessibilidade

`aria-label` com contagem ("Notificações, N não lidas"), `aria-live="polite"` após marcar como lida, severidade nunca só por cor (badge + texto + `sr-only`), `<time dateTime>`, navegação por teclado via `DropdownMenu` (Radix/Base UI já acessível), foco gerenciado pelo próprio componente de overlay.

## 14. Privacidade

Nunca persistido em `Notification`: CNPJ/CPF/documento completo, e-mail integral desnecessário, dados de saúde/assinatura/foto, token/senha/cookie, identidade do solicitante de uma claim (testado explicitamente: `SST_COMPANY_CLAIM_STARTED` nunca contém nome/e-mail/id do requerente). `assertNoSecrets` (reaproveitado) bloqueia título/mensagem/metadata com padrão de segredo conhecido.

## 15. Performance

Sino: no máximo 5 itens, `select` mínimo, receipts filtrados pelo usuário atual via `include` (1 JOIN, não 1 query por notificação). Contador: `count()` agregado (2 no máximo, um por `pendingVia`), nunca carrega todas as notificações. Páginas completas: paginação server-side real (Prisma `skip`/`take`).

## 16. Concorrência

Testado com PostgreSQL real (`tests/tenant-isolation/notifications.test.ts`, describe "Concorrência"): duas criações simultâneas com a mesma `dedupeKey` resultam em uma única notificação; duas leituras simultâneas da mesma notificação criam um único receipt. Os testes de concorrência das transições de domínio em si (aprovação/rejeição simultâneas de `SstProviderCompany`/`CompanyClaimRequest`) já existiam e continuam passando sem alteração de comportamento.

## 17. Testes adicionados

- `tests/notifications-visibility.test.ts` (16 testes, puro) — política de visibilidade e matriz de papéis SST.
- `tests/notification-action.test.ts` (incluído no total acima) — resolver de navegação.
- `tests/tenant-isolation/notifications.test.ts` (39 testes, PostgreSQL real) — invariantes de modelo (incluindo a CHECK constraint via INSERT bruto), visibilidade por portal/papel/permissão/tenant, todos os eventos de domínio wireados, leitura/dispensa individual, CSRF de uma rota representativa por portal, concorrência, privacidade.
- Dois bugs reais encontrados e corrigidos graças a estes testes (documentados nas seções 6 e 8).
- `tests/helpers/db.ts` — `cleanupFixtures` estendido para apagar `Notification` antes de `Company`/`SstProvider` (FK `Restrict`), sem alterar comportamento para nenhum teste pré-existente.

**Cobertura vs. os 78 itens do spec**: as invariantes de segurança/correção mais críticas (isolamento de tenant, CSRF, dedupe, privacidade, concorrência, wiring transacional de cada evento) estão cobertas por teste real. Não foram escritos testes numerados 1:1 para cada um dos 78 itens listados (ex.: nem toda combinação de filtro/categoria de UI tem teste dedicado) — trade-off deliberado dado o escopo da sprint; nenhuma lacuna conhecida de segurança ficou sem teste.

## 18. Validação manual (roteiro para o operador — não executado pelo agente)

Nenhum navegador foi acessado nesta sprint (mesma limitação de todas as sprints anteriores). Roteiro pronto para execução:

### Portal Empresa
1. Entrar em uma Company como ADMIN (permissão `SST_PROVIDER_MANAGE`).
2. Confirmar sino sem badge (nenhuma solicitação pendente).
3. Em outra sessão/navegador, como OWNER de uma consultoria, solicitar acesso a esta empresa (`/sst/companies/new` → solicitar).
4. Voltar ao Portal Empresa, confirmar badge = 1 (pode levar até 45s pelo polling, ou atualizar a página).
5. Abrir o popover, confirmar item "Nova solicitação de acesso SST".
6. Clicar "Ver" → confirmar navegação para `/configuracoes/sst-providers`.
7. Aprovar a solicitação.
8. Voltar ao sino, confirmar que a notificação de solicitação não conta mais como pendente.
9. Trocar de Company (se houver mais de uma) → confirmar que o contador/lista mudam imediatamente para a nova empresa.
10. Clicar "Marcar todas como lidas" → confirmar badge zera.

### Portal Consultoria SST
1. Login como a consultoria que teve o pedido aprovado no passo acima.
2. Confirmar notificação "Acesso liberado" no sino.
3. Clicar "Ver" → confirmar navegação para `/sst/companies/<id>` (abre a empresa).
4. Na empresa, suspender o acesso desta consultoria.
5. Voltar ao Portal Consultoria, confirmar notificação "Acesso suspenso".
6. Clicar na notificação ANTIGA de "Acesso liberado" (ainda no histórico) → confirmar que a rota de destino bloqueia o acesso à empresa (a suspensão revalidada pela própria página, nunca pela notificação).
7. Repetir aprovação/suspensão/revogação logado como TECHNICIAN e como VIEWER — confirmar que cada um só recebe os tipos previstos na matriz (§7).

### Portal Super Admin
1. Criar uma `CompanyClaimRequest` (registro público sobre uma empresa pré-cadastrada, ou diretamente).
2. Login como Super Admin, confirmar sino com "Nova reivindicação empresarial".
3. Abrir a claim pela notificação.
4. Com um segundo usuário, criar uma segunda solicitação para a MESMA empresa.
5. Confirmar notificação "Empresa em disputa" no sino do Super Admin.
6. Aprovar uma das claims.
7. Confirmar que ambas as notificações (reivindicação e disputa) saem da lista de pendentes.

### Responsividade
Validar desktop/notebook/tablet/mobile 375px: popover não sai da tela, badge não quebra layout, página completa (`/notifications` e equivalentes) sem overflow horizontal, navegação por teclado (Tab até o sino, Enter abre o popover, Escape fecha).

Registrar para cada cenário: aprovado/reprovado, horário, usuário de teste, ambiente, screenshot, bug encontrado, severidade — mesmo formato das sprints anteriores (`docs/sprint-1.4d.2-homologation-gate.md`, §5).

## 19. Plano de implantação (não executado)

1. Backup de produção.
2. Concluir a homologação manual pendente das Sprints 1.4D/1.4D.1/1.4D.2 (ainda não executada) — esta sprint SOMA a essa pendência, não a substitui.
3. Decidir MFA do Super Admin (bloqueador já documentado em `docs/sprint-1.4d.1-hardening.md`, inalterado por esta sprint).
4. `npx prisma migrate deploy` (inclui a migration `20260716124922_notifications`, puramente aditiva).
5. Deploy atômico do HEAD final.
6. Smoke test dos três portais: sino carrega sem erro, contador correto, popover abre.
7. Gerar uma solicitação SST real de homologação (consultoria → empresa existente).
8. Validar sino da empresa (badge, popover, aprovação).
9. Validar sino da consultoria (aprovação recebida, ação "Ver" funciona).
10. Gerar uma claim real (ou usar uma já pendente).
11. Validar sino do Super Admin.
12. Testar revogação de um acesso SST com uma aba antiga aberta na notificação de aprovação → confirmar bloqueio real na rota de destino.
13. Monitorar logs estruturados (`platform_audit_event`, `audit_event`) e taxa de `dedupeHit` nos primeiros dias.
14. Manter e-mail, push e WebSocket desativados (nada disso foi implementado).

Produção com clientes reais continua **NO-GO** pelos mesmos motivos já registrados na Sprint 1.4D.2 (validação manual em navegador real ainda pendente; MFA do Super Admin ainda não resolvido) — esta sprint não altera essa decisão.

## 20. Riscos remanescentes

- Validação manual em navegador real segue pendente para TODAS as sprints desde a 1.4D (não só esta).
- MFA/reautenticação do Super Admin seguem ausentes (risco já classificado).
- Sem backfill: eventos ocorridos antes do deploy desta sprint nunca geram notificação retroativa — aceitável e documentado (§29 do spec), mas vale comunicar aos usuários que "nada aparecerá" para solicitações/decisões já em andamento no momento do deploy.
- Cobertura de teste não é 1:1 com os 78 itens numerados do spec (ver §17) — as lacunas são de UI/variações de filtro, não de segurança.
- `markAllNotificationsRead`/dedupe tiveram bugs reais corrigidos nesta própria sprint graças aos testes escritos — reforça que qualquer nova função `notify*`/de leitura adicionada no futuro deve vir acompanhada de teste de concorrência real (PostgreSQL), não só teste unitário.

## 21. Confirmação de exclusões

Não implementados nesta sprint: e-mail, WhatsApp, push notification, WebSocket, Server-Sent Events, aplicativo mobile, preferências avançadas por tipo, alertas de estoque/CA/custódia/treinamentos, notificações para colaboradores, digest diário, escalonamento automático, integração externa, impersonação, MFA, subdomínios, cadastro/edição de colaboradores pela consultoria, billing, mudanças amplas de autenticação, redesign dos portais, deploy.
