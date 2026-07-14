# Portal Consultoria SST

Portal onde uma consultoria/técnico externo de SST acessa diretamente o
sistema (sem passar pela empresa) para acompanhar e **operar** a
conformidade de treinamento das empresas que a autorizaram.

- **Sprint Comercial 1.1** — fundação somente leitura: dashboard, lista de
  empresas vinculadas, resumo por empresa.
- **Sprint Comercial 1.2** — telas funcionais de treinamentos/turmas/
  colaboradores, substituindo os placeholders da 1.1: criar/editar
  `CompanyTraining`, criar/gerenciar `TrainingClass`, adicionar
  participantes, registrar presença/resultado — ver seções 10-13.

## 1. Objetivo

`docs/sst-providers.md` construiu a base do lado da empresa (autorizar,
suspender, revogar uma consultoria). Até esta sprint, **nenhum prestador
tinha qualquer forma de entrar no sistema** — só a empresa via/gerenciava o
vínculo. O Portal Consultoria é o outro lado: a própria consultoria loga em
`/sst` e vê, para cada empresa que a autorizou, o que está vencido,
vencendo ou faltando — foco comercial (mostrar valor rápido), não
operacional.

## 2. Portal Empresa vs. Portal Consultoria

|                     | Portal Empresa (`/`, `/dashboard`, ...) | Portal Consultoria (`/sst`) |
|---------------------|------------------------------------------|-------------------------------|
| Tenant               | `Company` (via `User.companyId`)         | `SstProvider` (via `SstProviderUser`) |
| Autorização           | `requirePermission`/`requireRole` (RBAC) | `requireSstAuth`/`requireSstProviderCompanyAccess` |
| Escopo de dados       | Tudo da própria empresa                  | Só empresas com `SstProviderCompany.status = ACTIVE` |
| Menus                | Ativos, Estoque, Entregas, Custódias, Configurações | Dashboard, Empresas (nada de Portal Empresa) |

Os dois portais compartilham a mesma identidade (`User`, sessão Better
Auth) — um usuário pode, hoje ou no futuro, ter login de empresa E de
consultoria ao mesmo tempo. Isso é intencional e não gera nenhum
compartilhamento de dados: cada portal resolve seu próprio tenant a partir
de tabelas diferentes.

## 3. `SstProviderUser` — o que dá acesso ao portal

Novo model (`prisma/schema.prisma`), sem alterar `SstProvider`/
`SstProviderCompany`:

```
SstProviderUser { id, providerId, userId, role (OWNER|TECHNICIAN|VIEWER), active, createdAt, updatedAt }
@@unique([providerId, userId])
```

Acesso ao Portal Consultoria exige, simultaneamente:
1. `SstProviderUser.active = true`
2. `SstProviderUser.provider.active = true`

**O Portal Consultoria NUNCA lê `User.companyId` como tenant.** O tenant é
sempre `SstProvider`, resolvido via `SstProviderUser`. Isso é verificado em
código (`lib/sst-auth.ts` não referencia `companyId` do usuário em nenhum
momento) e no checklist de segurança da seção 6.

`@@unique([providerId, userId])`, não só `userId` — permite, no futuro, um
mesmo usuário atuar em mais de uma consultoria. Nesta sprint não existe
seletor de consultoria na UI: `requireSstAuth()` sempre usa o vínculo mais
antigo (`orderBy: createdAt asc`) quando houver mais de um. Simplificação
documentada, não um limite de modelagem.

## 4. Acesso a empresa — `SstProviderCompany`

Mesma tabela que já existia (`docs/sst-providers.md`), reaproveitada sem
mudança de schema. Uma empresa só aparece para a consultoria se o vínculo
estiver `ACTIVE`. `companyId` sempre vem da URL (`/sst/companies/[id]`), e
é **sempre** revalidado contra esse vínculo antes de qualquer leitura
(`requireSstProviderCompanyAccess`) — nunca confiado por si só, mesmo
raciocínio já usado para `companyId` de sessão no Portal Empresa.

## 5. Helpers — `lib/sst-auth.ts`

Módulo separado de `lib/auth-server.ts`, nunca misturado com
`requirePermission`/`requireCompany` (RBAC de empresa):

- `requireSstAuth()` — identidade (via `requireAuth()`, mesma sessão de
  todo o app) + vínculo `SstProviderUser` ativo com provider ativo. Lança
  `ForbiddenError` caso contrário.
- `getCurrentSstUser()` — variante não-lançável (`null` em vez de lançar).
- `getCurrentSstProvider()`, `requireSstRole(role)`.
- `requireSstProviderCompanyAccess(companyId)` — valida vínculo `ACTIVE`
  provider↔empresa.
- `requireSstCompanyViewAccess(companyId)` — alias de
  `requireSstProviderCompanyAccess`; qualquer vínculo `ACTIVE` já concede
  leitura, independente de papel/`accessLevel`.
- `requireSstCompanyOperationAccess(companyId)` — ações operacionais
  (criar/editar turma, adicionar/remover participante, registrar
  presença/resultado); exige `accessLevel` OPERATION/ADMINISTRATION e papel
  diferente de VIEWER (ver seção 10, matriz de acesso).
- `requireSstCompanyAdministrationAccess(companyId)` — ações
  administrativas (criar/editar/desativar `CompanyTraining`); exige
  `accessLevel` ADMINISTRATION e papel diferente de VIEWER.
- `sstCanOperate(ctx)`/`sstCanAdminister(ctx)` — variantes puras (não
  lançam) dos dois helpers acima, usadas nas páginas só para decidir se um
  botão de escrita aparece, sem bloquear a tela inteira para quem só tem
  leitura (ex.: lista de treinamentos continua visível para VIEW, só sem o
  botão "Novo treinamento").
- `buildSstActor(ctx)` — monta o `ActorInput` (`lib/audit.ts`) a partir do
  contexto autenticado, para passar aos services de treinamento
  reaproveitados do Portal Empresa (seção 11).
- Variantes `*OrDeny` para Server Components (`requireSstAuthOrDeny`,
  `requireSstProviderCompanyAccessOrDeny`,
  `requireSstCompanyOperationAccessOrDeny`,
  `requireSstCompanyAdministrationAccessOrDeny`), usando os boundaries
  `app/sst/forbidden.tsx`/`app/sst/unauthorized.tsx` (redirecionam para
  `/sst/login`, não para `/dashboard`/`/login` do Portal Empresa) — usadas
  nas páginas cujo conteúdo INTEIRO exige aquele nível (ex.:
  `/trainings/new` exige administration; a lista de treinamentos em si
  exige só view).

Reaproveita `AuthError`/`ForbiddenError` de `lib/auth-server.ts` para que
`handleApiError` (`lib/api-errors.ts`) funcione sem mudança nas rotas
`/api/sst/*`.

## 6. Regras de segurança e onde cada uma é aplicada

| Regra | Onde |
|---|---|
| Usuário sem `SstProviderUser` não acessa `/sst` | `requireSstAuth` lança `ForbiddenError` |
| `SstProviderUser` inativo não acessa | mesmo `where: { active: true }` |
| `SstProvider` inativo não acessa | mesmo `where: { provider: { active: true } }` |
| Provider sem vínculo `ACTIVE` não vê a empresa | `requireSstProviderCompanyAccess` |
| Provider não acessa `companyId` de outra empresa | toda rota/página de empresa chama `requireSstProviderCompanyAccess(companyId)` antes de ler dados |
| Portal Consultoria não acessa Ativos/Estoque/Entregas | `app/sst/*` só importa `lib/sst-dashboard.ts`, que só consulta `Employee` (leitura), `CompanyTraining`, `TrainingClass`, `TrainingParticipant`, `Company` |
| `/api/sst/*` nunca usa `User.companyId` como tenant | `providerId` sempre vem de `requireSstAuth()`/`SstProviderUser`, nunca de `user.companyId` |
| `providerId` nunca vem do client | toda rota resolve `providerId` da sessão; nenhum endpoint aceita `providerId` em body/query |
| Papel VIEWER nunca escreve, mesmo com vínculo ADMINISTRATION | `assertRoleCanWrite` dentro de `requireSstCompanyOperationAccess`/`requireSstCompanyAdministrationAccess` |
| Vínculo VIEW nunca escreve, mesmo com papel OWNER/TECHNICIAN | mesmo par de helpers, checagem de `link.accessLevel` |
| `companyId`/`managementMode`/`managedByProviderId` forjados no body são ignorados | rotas de treinamento sempre sobrescrevem esses campos após o parse Zod, nunca confiam no client (seção 11) |
| Provider nunca opera treinamento/turma gerenciado por outro | `assertProviderManagesCompanyTraining` (`lib/sst-trainings.ts`), chamado antes de toda escrita em treinamento/turma/participante |
| Portal Consultoria nunca cria/edita/inativa/exclui `Employee` | nenhuma rota `/api/sst/*` faz `create`/`update`/`delete` em `Employee` — só `findMany`/`findFirst` |

## 7. Limitações da Sprint Comercial 1.1 (somente leitura)

- **Sem motor de alertas persistido para treinamento** — `lib/alerts.ts`
  continua sem cobrir treinamentos. Todo indicador do Portal Consultoria é
  calculado sob demanda a partir de `TrainingParticipant.expiresAt` e
  `CompanyTraining.mandatory`, a cada requisição.
- **`getCompanyTrainingMetrics` por empresa não escala para centenas** —
  uma query por empresa vinculada é aceitável para o volume atual (dezenas
  por consultoria); agregação em query única ou cache fica para depois.
- **Sem seletor de consultoria** para um usuário vinculado a mais de um
  `SstProvider` (usa sempre o vínculo mais antigo).
- **Nota vs. status de conformidade são dois campos independentes**, não
  um derivado do outro: `complianceScore` (0-100, fórmula com penalidades)
  e `complianceStatus` (Em dia/Atenção/Crítica, regra direta sobre os
  mesmos contadores). O requisito desta sprint descreve as duas regras
  separadamente (limiares de nota vs. condição direta) — em vez de tentar
  unificá-las, ambas são calculadas e exibidas lado a lado.
- **"Colaborador sem treinamento obrigatório" é contado uma vez por
  colaborador**, não por par colaborador×treinamento — um colaborador com
  3 treinamentos obrigatórios pendentes conta como 1, consistente com a
  penalidade de -15 "por colaborador" na nota de conformidade.
- **Fórmula de conformidade é um MVP** (base 100, -10 vencido, -15
  colaborador sem obrigatório, -5 vencendo em 30 dias, 0-100) — sujeita a
  refinamento quando houver feedback real de uso.

## 8. Sprint Comercial 1.2 — operação de treinamentos

Substituiu os 3 placeholders (`trainings`/`classes`/`employees`) por telas
funcionais. A consultoria passa a poder criar/editar treinamentos que ela
mesma gerencia, criar turmas, adicionar participantes e registrar
presença/resultado — sempre dentro dos limites da matriz de acesso
(seção 10) e da regra de propriedade (seção 11). Nenhum service de negócio
foi duplicado: as mesmas funções já usadas pelo Portal Empresa
(`createCompanyTraining`, `createTrainingClass`, `addParticipants`,
`updateParticipant`, etc., em `lib/trainings.ts`/`lib/training-classes.ts`/
`lib/training-participants.ts`) são chamadas as-is pelas rotas
`/api/sst/*`, só passando um `companyId` já validado pelo vínculo e um
`actor` construído por `buildSstActor` (seção 5).

## 9. Credenciais demo

Seed (`prisma/seed.ts`, `seedSstPortalDemo`): provider **"Consultoria
Segura SST"** (distinto de "Consultoria SST Demo", que ilustra um
`CompanyTraining EXTERNAL_PROVIDER` do lado da empresa), usuário
`sst@demo.com` / `Demo@12345`, `SstProviderUser` `role: OWNER`/`active:
true`, vínculo `SstProviderCompany` `ACTIVE`/`ADMINISTRATION` com a empresa
demo. O `companyId` desse `User` aponta para a empresa demo só para
satisfazer a constraint `NOT NULL` do schema — irrelevante para o portal,
nunca lido por `lib/sst-auth.ts`.

## 10. Matriz de acesso (Sprint Comercial 1.2)

Duas dimensões independentes decidem o que uma sessão do Portal
Consultoria pode escrever: o **papel** do usuário no provider
(`SstProviderUser.role`) e o **nível de acesso** do vínculo com aquela
empresa (`SstProviderCompany.accessLevel`).

| | VIEW | OPERATION | ADMINISTRATION |
|---|---|---|---|
| **VIEWER** (qualquer vínculo) | leitura | leitura | leitura |
| **TECHNICIAN** | leitura | leitura + escrita operacional | leitura + escrita operacional |
| **OWNER** | leitura | leitura + escrita operacional | leitura + escrita operacional + administra |

`VIEWER` nunca escreve, independente do `accessLevel` do vínculo —
checado antes de qualquer outra coisa em
`requireSstCompanyOperationAccess`/`requireSstCompanyAdministrationAccess`.
Para os outros dois papéis, quem decide é só o `accessLevel`: esta sprint
não implementa nenhuma ação exclusiva de `OWNER` (gestão do próprio
provider/seus usuários fica fora de escopo — seção 12), então `OWNER` e
`TECHNICIAN` se comportam de forma idêntica para as ações de treinamento
implementadas. Se uma ação "só-`OWNER`" for adicionada numa sprint futura,
ela deve ganhar seu próprio helper (`requireSstRole("OWNER")` já existe)
em vez de sobrecarregar `requireSstCompanyAdministrationAccess`.

Escrita operacional: criar/editar turma, cancelar turma, adicionar/remover
participante, registrar presença/resultado. Escrita administrativa: criar
`CompanyTraining` a partir de template ou personalizado, editar/desativar
`CompanyTraining`.

## 11. Regra de propriedade — quem pode operar o quê

`CompanyTraining` continua pertencendo à empresa (`companyId` nunca muda,
mesmo raciocínio de `docs/sst-providers.md`) — a consultoria **gerencia**,
nunca é dona.

- **Criar treinamento**: `managementMode`/`managedByProviderId` do body são
  sempre ignorados/sobrescritos pela rota — a criação sempre resulta em
  `managementMode: EXTERNAL_PROVIDER` + `managedByProviderId` = provider da
  sessão, nunca outro valor.
- **Editar/desativar treinamento**: só permitido se
  `managedByProviderId === provider da sessão` — checado por
  `assertProviderManagesCompanyTraining` (`lib/sst-trainings.ts`) antes de
  chamar `updateCompanyTraining`/`deactivateCompanyTraining`. **Decisão
  arquitetural**: não existe exceção "treinamento INTERNAL + vínculo
  ADMINISTRATION" — a consultoria só edita o que ela mesma criou/assumiu
  via `managementMode: EXTERNAL_PROVIDER`, nunca treinamentos internos da
  empresa nem de outro prestador. O PUT também força
  `managementMode`/`managedByProviderId`, impedindo que a edição "solte" o
  treinamento ou o repasse para outro provider.
- **Criar/editar turma**: mesma regra aplicada ao `CompanyTraining` que a
  turma referencia (`companyTrainingId`) — só turmas de treinamentos
  gerenciados por este provider. Checado tanto na criação quanto na edição
  (inclusive se o payload tentar reatribuir a turma a outro
  `companyTrainingId`).
- **Adicionar/remover participante, registrar presença/resultado**: mesma
  regra, aplicada à turma (via seu `companyTrainingId`) antes de qualquer
  escrita — reforça que um vínculo `OPERATION`/`ADMINISTRATION` não dá
  acesso a turmas de treinamentos que a consultoria não gerencia.
- **Listar treinamentos**: sem filtro — todos os treinamentos da empresa
  aparecem, com um badge calculado a partir do já retornado
  `managedByProvider.{companyLinks[].status}` (sem query extra, mesmo dado
  já usado pelo badge "Prestador sem autorização ativa" do Portal Empresa
  desde a Sprint 2.5):
  - `managedByProviderId` = provider da sessão → "Gerenciado por esta
    consultoria"
  - `managementMode: INTERNAL` → "Gerenciado internamente"
  - `EXTERNAL_PROVIDER` de outro provider, vínculo dele `ACTIVE` →
    "Gerenciado por outro prestador"
  - `EXTERNAL_PROVIDER` de outro provider sem vínculo `ACTIVE` →
    "Prestador sem vínculo ativo"

## 12. Auditoria — `AuditActorType`

`AuditLog` não distinguia "de qual portal" uma ação veio — só
`actorUserId`/`actorName` (que já fazem sentido para um usuário de
consultoria, que também é um `User`). Menor alteração aditiva possível:
duas colunas novas, com default seguro para todo histórico anterior.

```prisma
enum AuditActorType {
  COMPANY_USER
  SST_PROVIDER_USER
}

model AuditLog {
  // ...campos existentes...
  actorType  AuditActorType @default(COMPANY_USER)
  providerId String?
  provider   SstProvider?   @relation(fields: [providerId], references: [id], onDelete: SetNull)
}
```

`@default(COMPANY_USER)` faz o Postgres preencher automaticamente todo log
já existente na migration — nenhum backfill manual necessário. Nenhuma
`AuditAction` nova foi criada: as mesmas ações (`training.create`,
`training_class.create`, `training_participant.add`, etc.) são
reaproveitadas tanto pelo Portal Empresa quanto pelo Portal Consultoria;
`actorType`/`providerId` já distinguem quem agiu, sem duplicar semântica
de "o que aconteceu".

`lib/audit.ts` exporta `ActorInput = { id, name, actorType?, providerId?
}` — o parâmetro `actor` de `createCompanyTraining`/`createTrainingClass`/
`addParticipants`/etc. (em `lib/trainings.ts`/`lib/training-classes.ts`/
`lib/training-participants.ts`) foi ampliado de `{id, name}` para esse
tipo. **Nenhuma rota do Portal Empresa mudou**: elas continuam passando só
`{ id: user.id, name: user.name }`, que ainda satisfaz `ActorInput`
estruturalmente (`actorType` cai no default `COMPANY_USER`, `providerId`
fica `undefined`). `buildSstActor` (`lib/sst-auth.ts`) monta o lado do
Portal Consultoria: `{ id: user.id, name: user.name, actorType:
"SST_PROVIDER_USER", providerId }` — `id` é sempre `User.id` real (FK de
`AuditLog.actorUserId`), nunca `SstProviderUser.id`.

Nenhum dado sensível (CPF/documento completo, senha, token) é adicionado a
`metadata`/`targetLabel` — mesma disciplina já seguida pelos services
reaproveitados.

## 13. APIs novas (`/api/sst/companies/[companyId]/...`)

| Rota | Métodos | Autorização |
|---|---|---|
| `trainings` | GET, POST | view / administration |
| `trainings/[trainingId]` | GET, PUT, DELETE (soft) | view / administration + posse |
| `training-templates` (fora do escopo de empresa) | GET | `requireSstAuth` |
| `employees` | GET (paginado, só leitura) | view |
| `employees/[employeeId]/trainings` | GET (resumo para o dialog) | view |
| `classes` | GET, POST | view / operation + posse |
| `classes/[classId]` | GET, PUT | view / operation + posse |
| `classes/[classId]/participants` | GET, POST | view / operation + posse |
| `classes/[classId]/participants/[participantId]` | PUT, DELETE | operation |

`employees/[employeeId]/trainings` é uma pequena adição além da lista
literal do requisito — necessária para o dialog "resumo de treinamentos"
da tela de colaboradores (seção 8) não obrigar a listagem paginada a trazer
o histórico completo de cada linha.

`lib/sst-employees.ts` (novo) — `getSstCompanyEmployeesPage` pagina
`Employee` primeiro e só então faz 2 queries adicionais para a página
inteira (treinamentos obrigatórios da empresa + participações dos
colaboradores da página), nunca uma query por colaborador. Status por
colaborador (`EM_DIA`/`ATENCAO`/`PENDENTE`, via
`classifyEmployeeTrainingStatus`) é um enum próprio de granularidade de
colaborador — não é o mesmo enum de `SstComplianceStatus`
(`lib/sst-dashboard.ts`, granularidade de empresa), mesmo raciocínio de
contagem.

## 14. Simplificações de UX desta sprint

- Formulário de turma em página única, não o wizard de 5 passos do Portal
  Empresa — alinhado à seção 11 do requisito ("demonstração em menos de 3
  minutos"). Mesma lógica de captura de dados, menos cliques.
- Tabelas do Portal Consultoria usam markup HTML direto (`Table`/
  `TableRow`/...) em vez de TanStack Table — não há necessidade de
  reordenar/redimensionar colunas nestas telas, e o ganho é menos código
  por tela.
- Sem toast de sucesso nas ações de turma/participante (diferente do
  Portal Empresa) — erros aparecem inline; a navegação/`router.refresh()`
  já comunica sucesso visualmente. Deliberado para reduzir dependências
  novas nesta sprint; pode ser alinhado ao padrão `sonner` do resto do app
  depois, sem mudança de contrato de API.

## 16. Pré-cadastro de empresa (Sprint Comercial SST 1.4)

Antes desta sprint, a consultoria só operava empresas que já tinham feito o
próprio cadastro (`/register`) e depois autorizado o vínculo pelo Portal
Empresa. Agora a consultoria também pode iniciar esse processo a partir do
CNPJ — `/sst/companies/new`, só para `OWNER` (`requireSstRoleOrDeny("OWNER")`).

**Regra central, permanente**: a empresa é sempre dona dos seus dados;
`Company.createdByProviderId` é só proveniência (nunca concede acesso
sozinho); todo acesso da consultoria continua sendo via `SstProviderCompany`;
revogar uma consultoria nunca apaga dado nenhum; conhecer o CNPJ de uma
empresa nunca dá acesso a ela; outra consultoria nunca recebe acesso
automático a uma empresa que outra já pré-cadastrou.

Fluxo (`lib/sst-company-provisioning.ts`):

1. `POST /api/sst/companies/check-cnpj` — verificação somente leitura.
   Devolve um destes status, nunca mais informação que o necessário: `AVAILABLE`
   (CNPJ livre) · `ALREADY_AUTHORIZED` (só aqui devolve `companyId`/`companyName`
   — a consultoria já tem acesso de qualquer forma) · `AUTHORIZATION_REQUIRED`
   (empresa existe, sem vínculo) · `AUTHORIZATION_PENDING` · `RELATIONSHIP_REVIEW_REQUIRED`
   (vínculo SUSPENDED/REVOKED/REJECTED — nunca reativado automaticamente) ·
   `COMPANY_UNAVAILABLE` (empresa SUSPENDED/CLOSED, sem vínculo ainda).
2. `POST /api/sst/companies/pre-register` (`{ cnpj, name }` — só esses dois
   campos; qualquer outro campo enviado é ignorado pelo Zod) — cria `Company`
   (`controlStatus: UNCLAIMED`, `origin: SST_PROVIDER`, `createdByProviderId`
   da sessão) + `SstProviderCompany` (`ACTIVE`, `ADMINISTRATION`) na MESMA
   transação. Nunca cria uma segunda `Company` para o mesmo CNPJ — a
   constraint única `(documentType, documentNormalized)` é a fonte final de
   verdade; sob corrida (duas requisições, mesma consultoria ou outra), quem
   perde captura o `P2002` e cai no fluxo de empresa existente (vira um
   pedido `PENDING` comum, nunca herda `ADMINISTRATION` de graça).
3. `POST /api/sst/companies/request-access` (`{ cnpj }`) — para uma empresa
   já existente: cria `SstProviderCompany` `PENDING` (nunca concede acesso
   imediato); não duplica se já `ACTIVE`/`PENDING`; nunca reativa
   `SUSPENDED`/`REVOKED`/`REJECTED` automaticamente; nunca cria acesso para
   empresa `SUSPENDED`/`CLOSED`.

Estados do vínculo ganharam `REJECTED` (antes só `PENDING`/`ACTIVE`/
`SUSPENDED`/`REVOKED`) — distinto de `REVOKED` (que só existe depois de ter
sido `ACTIVE`) e de `SUSPENDED` (pausa reversível): uma solicitação recusada
sem nunca ter sido autorizada. `REVOKED` e `REJECTED` são estados terminais —
`updateProviderLinkStatus` (`lib/sst-providers.ts`) rejeita qualquer PATCH
sobre um vínculo nesses estados.

No Portal Empresa, `/configuracoes/sst-providers` ganhou "Aprovar" (com
escolha do nível de acesso no momento da aprovação — não herda mais o nível
pedido pela consultoria) e "Recusar" para vínculos `PENDING`, além de um
badge com a contagem de solicitações pendentes.

Rate limiting (`proxy.ts`, bucket `sst-cnpj`) cobre os três endpoints como
camada extra contra enumeração de CNPJ, além da exigência de sessão OWNER
autenticada.

**Fora de escopo desta sprint** (ver spec original): cadastro/edição de
colaboradores pela consultoria; `CompanyClaim` completo (o que acontece
quando a empresa pré-cadastrada finalmente faz seu próprio cadastro real —
hoje `/register` só bloqueia a duplicação com a mensagem "Esta empresa já
possui um pré-cadastro...", nunca implementa a reivindicação em si); Super
Admin; validação externa de CNPJ (Receita Federal); e-mail de notificação;
merge automático de empresas duplicadas reais.

## 17. Roadmap (Sprint Comercial 1.5+)

- Certificados, upload de documentos.
- Alertas persistidos para treinamento (extensão de `lib/alerts.ts`).
- Relatórios completos, agenda avançada.
- Notificações/WhatsApp.
- `CompanyClaim` completo (seção 16) — fluxo de reivindicação de uma empresa
  `UNCLAIMED` quando ela finalmente se cadastra de verdade.
- Cadastro/edição de colaboradores pela consultoria (deliberadamente adiado
  até a aprovação do fluxo de pré-cadastro da seção 16).
