# Arquitetura do módulo de Treinamentos — hardening (Sprint 2.5)

Este documento cobre as 5 melhorias arquiteturais entregues depois da
auditoria completa do módulo (catálogo, turmas, participantes, prestadores
SST): audit trail, máquina de estados de `TrainingClass`, correção de
concorrência, índices de escalabilidade e o resolver de autorização. Nada
aqui mudou comportamento observável pelo usuário (mesmos endpoints, mesmos
formatos de resposta, mesma UX), exceto a restrição de transições de status
inválidas — que é o próprio objetivo da seção 2. Para o domínio em si
(models, regras de negócio, RBAC), ver `docs/trainings-domain.md` e
`docs/sst-providers.md`.

## 1. State machine de `TrainingClass`

Antes desta sprint, `PUT /api/training-classes/[id]` aceitava qualquer
valor de `status` sem checar a transição — um `COMPLETED` podia voltar para
`SCHEDULED` livremente. Agora toda mudança de status passa por
`assertTrainingClassTransition(current, next)` (`lib/training-classes.ts`),
chamada de dentro de `updateTrainingClass()` — **nenhuma rota lê ou escreve
`status` diretamente**.

### Transições permitidas

| De ↓ / Para → | SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED |
|---|---|---|---|---|
| **SCHEDULED** | ✅ (identidade) | ✅ | ❌ | ✅ |
| **IN_PROGRESS** | ❌ | ✅ (identidade) | ✅ | ✅ |
| **COMPLETED** | ❌ | ❌ | ✅ (identidade) | ❌ |
| **CANCELLED** | ❌ | ❌ | ❌ | ✅ (identidade) |

Identidade (`X → X`) é sempre permitida — necessário para salvar outros
campos (título, local, instrutor...) sem forçar uma mudança de status a
cada edição.

### Decisão explícita: `IN_PROGRESS → CANCELLED` é permitida

O requisito desta sprint pedia essa decisão de forma explícita
("permitir ou bloquear... documentar"). Optei por **permitir**: a Sprint 1
já entregou e mantém em produção o botão "Cancelar turma"
(`app/(app)/trainings/classes/training-classes-table.tsx`), habilitado
tanto para `SCHEDULED` quanto para `IN_PROGRESS`
(`canCancel = status === "SCHEDULED" || status === "IN_PROGRESS"`).
Bloquear essa transição na state machine quebraria uma funcionalidade já
existente e usada, o que violaria a regra desta sprint de não quebrar UX
existente.

`COMPLETED` e `CANCELLED` são estados terminais em todos os outros casos —
inclusive `COMPLETED → CANCELLED`, que o requisito não listou
explicitamente como proibida, mas que bloqueei por consistência (uma turma
que já aconteceu não faz sentido ser "cancelada" depois).

### Erro ao bloquear

`ValidationError` (400) com mensagem amigável, ex.: `Não é possível mudar o
status da turma de "Concluída" para "Agendada".` — capturado pelo mesmo
`handleApiError` padrão do resto do sistema.

## 2. Audit trail

Reaproveita 100% o sistema existente — `AuditLog` (model já existente,
nenhuma tabela nova) + `logAudit()` (`lib/audit.ts`). O union `AuditAction`
ganhou 14 valores novos, seguindo a convenção `entidade.verbo` já usada
(`user.block`, `custody.deliver`, `employee.delete`...) em vez do
`UPPER_SNAKE_CASE` do requisito original — mesma adaptação de nomenclatura
já feita para as permissões `sst_provider:*` na sprint anterior.

| Ação (requisito) | `AuditAction` | Disparada em |
|---|---|---|
| TRAINING_CREATED | `training.create` | `POST /api/trainings` |
| TRAINING_UPDATED | `training.update` | `PUT /api/trainings/[id]` |
| TRAINING_DEACTIVATED | `training.deactivate` | `DELETE /api/trainings/[id]` |
| TRAINING_CLASS_CREATED | `training_class.create` | `POST /api/training-classes` |
| TRAINING_CLASS_UPDATED | `training_class.update` | `PUT /api/training-classes/[id]` (status final ≠ CANCELLED, ou não muda) |
| TRAINING_CLASS_CANCELLED | `training_class.cancel` | mesma rota, quando o status novo é CANCELLED e o anterior não era |
| TRAINING_PARTICIPANT_ADDED | `training_participant.add` | `POST .../participants` (um log por participante adicionado) |
| TRAINING_PARTICIPANT_REMOVED | `training_participant.remove` | `DELETE .../participants/[id]` |
| TRAINING_PARTICIPANT_ATTENDANCE_UPDATED | `training_participant.attendance_update` | `PUT .../participants/[id]`, quando `attendanceStatus` está no payload |
| TRAINING_PARTICIPANT_RESULT_UPDATED | `training_participant.result_update` | mesma rota, quando `resultStatus` está no payload |
| SST_PROVIDER_CREATED | `sst_provider.create` | `POST /api/sst-providers` |
| SST_PROVIDER_APPROVED | `sst_provider.approve` | `PATCH /api/sst-providers/[id]` com `status: ACTIVE` |
| SST_PROVIDER_SUSPENDED | `sst_provider.suspend` | mesma rota, `status: SUSPENDED` |
| SST_PROVIDER_REVOKED | `sst_provider.revoke` | mesma rota, `status: REVOKED` |

Atualizações que só mexem em `notes` (observação do participante) não
geram log — não há ação prevista para isso na lista pedida.

Cada chamada de `logAudit` registra `companyId` (empresa), `actorUserId` +
`actorName` (usuário, resolvidos de `requirePermission`), `createdAt`
automático (data), `action`, `targetType`/`targetId` (recurso/resourceId) e
`metadata` (payload resumido — nunca o registro inteiro). **Nunca inclui
dado sensível**: `SstProvider.document` (CNPJ/CPF) nunca aparece em
`metadata`/`targetLabel` das ações `sst_provider.*` — só o nome do
prestador, mesma regra já documentada em `lib/audit.ts` para não vazar
CPF/senha/token em log.

Toda mutação que agora audita passou a rodar dentro de
`prisma.$transaction(...)` (mesmo se antes não rodava) — se a escrita
falhar, o log não é gravado; se o log falhasse (não deveria, é a mesma
tabela/conexão), a escrita seria revertida junto. Isso é uma mudança de
implementação interna, não de comportamento observável.

## 3. Correção de concorrência em `addParticipants`

**Problema**: duas chamadas concorrentes de `POST .../participants` na
mesma turma podiam, em *Read Committed* (isolamento padrão do Postgres),
ambas contar a mesma capacidade disponível antes de qualquer uma
commitar — estourando `maximumParticipants`.

**Solução**: lock pessimista de linha (`SELECT ... FOR UPDATE`) na própria
`TrainingClass`, executado dentro da transação, **antes** de contar
participantes existentes. A segunda transação concorrente sobre a mesma
turma bloqueia no `FOR UPDATE` até a primeira commitar (ou reverter) —
nesse ponto ela já enxerga a contagem atualizada. Turmas diferentes não se
bloqueiam entre si (o lock é por linha, não por tabela).

```ts
const locked = await tx.$queryRaw<{ status: TrainingClassStatus; maximumParticipants: number | null }[]>`
  SELECT "status", "maximumParticipants" FROM "TrainingClass" WHERE id = ${trainingClassId} FOR UPDATE
`;
```

**Por que não o mesmo truque do estoque?** `app/api/custodies/deliver/route.ts`
resolve um problema parecido (saldo de consumível) com um `UPDATE`
condicional atômico (`updateMany` com `quantity: { gte: X }` no `WHERE`),
sem precisar de `FOR UPDATE` explícito — mas isso só funciona porque existe
uma **coluna contadora** (`StockBalance.quantity`) sendo decrementada no
mesmo statement, e o Postgres serializa automaticamente dois `UPDATE`
concorrentes na mesma linha. Aqui não existe coluna contadora —
`maximumParticipants` é comparado contra um `COUNT(*)` de
`TrainingParticipant`, uma tabela filha — então não há uma única linha
sendo atualizada atomicamente para o Postgres serializar sozinho. O
equivalente correto para uma restrição sobre uma agregação de filhos é
travar a linha pai antes de agregar, que é exatamente o que `FOR UPDATE`
faz. O nível de isolamento do resto do sistema continua `Read Committed`
— só esta transação específica ganha o lock explícito.

Efeito colateral positivo: como o `status`/`maximumParticipants` agora são
lidos **dentro** da transação, sobre a linha travada, uma janela de corrida
menor também foi fechada (turma cancelada bem no meio de uma chamada de
adicionar participante já não passa mais despercebida).

## 4. Índices adicionados

```prisma
// CompanyTraining
@@index([managedByProviderId])

// TrainingParticipant
@@index([companyId, expiresAt])
```

- **`CompanyTraining.managedByProviderId`**: suporta a consulta natural do
  futuro Portal Consultoria ("todos os treinamentos que este prestador
  gerencia, em todas as empresas") — hoje já usada indiretamente pelo
  `TrainingAuthorizationResolver` (seção 5).
- **`TrainingParticipant.[companyId, expiresAt]`** (composto, não
  `expiresAt` isolado): toda leitura de vencimento é sempre por empresa —
  mesmo padrão de alerta já usado no resto do sistema (nunca uma varredura
  global, ver `docs/alerts.md`). A futura sprint de alertas de reciclagem
  vai filtrar exatamente por esses dois campos juntos.

Nenhum índice redundante — os já existentes (`companyId`,
`trainingTemplateId`, `[companyId, active]`, `[companyId, trainingType]` em
`CompanyTraining`; `companyId`, `trainingClassId`, `employeeId` em
`TrainingParticipant`) continuam intactos, sem sobreposição com os dois
novos.

## 5. Training Authorization Resolver

`lib/training-authorization.ts` — ponto único de leitura para "quem
gerencia este `CompanyTraining` e o que essa parte pode fazer":

```ts
export type TrainingAuthorization = {
  companyId: string;
  managementMode: TrainingManagementMode;
  managedByProviderId: string | null;
  providerActive: boolean | null;
  providerStatus: SstProviderCompanyStatus | null;
  providerAccessLevel: SstProviderCompanyAccessLevel | null;
  isManagedInternally: boolean;
  isManagedByProvider: boolean;
  providerCanOperate: boolean;
  companyCanOperate: boolean;
};

resolveTrainingAuthorization(companyId, managementMode, managedByProviderId): Promise<TrainingAuthorization>
```

Antes desta sprint, a consulta a `SstProvider`/`SstProviderCompany` para
decidir "esse prestador pode gerenciar esse treinamento?" vivia só dentro
de `assertProviderCanManage` (`lib/sst-providers.ts`). Agora
`assertProviderCanManage` é uma casca fina sobre o resolver — mesma
consulta, mesmas 3 checagens (provider ativo → vínculo `ACTIVE` →
`accessLevel` ≠ `VIEW`), mesmas mensagens de erro, comportamento
observável idêntico, implementação consolidada num único lugar.

`providerCanOperate` e `companyCanOperate` são o ponto de extensão para o
futuro Portal Consultoria — hoje:

- `providerCanOperate` é sempre `false`: não existe sessão de prestador no
  sistema, então nenhum prestador tem ação própria hoje, independente do
  `status`/`accessLevel` do vínculo. Quando o portal existir, este campo
  passa a refletir se o vínculo está `ACTIVE` com `accessLevel` suficiente
  **e** existe uma sessão de prestador autenticada agindo — a troca é
  isolada a este arquivo, nenhum outro código do domínio depende de como
  esse valor é calculado.
- `companyCanOperate` é sempre `true`: todo chamador já passou por
  `requirePermission(training:manage)` antes de chegar aqui — o resolver
  não decide acesso, só descreve o estado. Nenhuma rota usa este campo para
  negar acesso nesta sprint.

**Uso concreto nesta sprint** (a única mudança de comportamento visível, e é
aditiva): o badge da seção 6.

## 6. Badge "Prestador sem autorização ativa"

Só em `/trainings` (`trainings-table.tsx`), ao lado do badge "Consultoria
SST" já existente. Aparece quando `managementMode === EXTERNAL_PROVIDER` e
o vínculo da empresa com aquele prestador não está `ACTIVE` (foi
suspenso/revogado, ou nunca existiu). **Só alerta visual — nunca altera o
treinamento automaticamente**, exatamente como pedido; a empresa continua
precisando editar manualmente o `managementMode`/`managedByProviderId` se
quiser trocar de prestador (comportamento já documentado como limitação
deliberada em `docs/sst-providers.md`).

Implementação sem N+1: `managedByProviderSelect(companyId)`
(`lib/trainings.ts`) inclui `managedByProvider.companyLinks` filtrado por
`companyId` na própria query (crítico — sem esse filtro vazaria vínculos de
**outras** empresas do mesmo `SstProvider` global) — uma única query, mesmo
para a listagem inteira, em vez de uma chamada ao resolver por linha.

## 7. Escalabilidade — o que muda com isso

Com os dois índices da seção 4, as duas consultas identificadas na
auditoria como scan completo em escala (300 mil `CompanyTraining`, 1 milhão
de `TrainingParticipant`) passam a ter índice dedicado. O lock de linha da
seção 3 não afeta escalabilidade horizontal — é por linha, então turmas
diferentes continuam com adições de participantes totalmente paralelas
entre si; só serializa o caso realista de duas pessoas mexendo na mesma
turma ao mesmo tempo.

## 8. Estratégia para o futuro Portal Consultoria

O que já está pronto depois desta sprint: audit trail cobrindo os eventos
de prestador (criação/aprovação/suspensão/revogação) e de operação
(criar/editar treinamento e turma, adicionar/remover participante,
presença/resultado) — pré-requisito de compliance para abrir o sistema a
um terceiro autenticado. `resolveTrainingAuthorization` já centraliza a
pergunta "esse prestador pode operar isso?" — quando existir sessão de
prestador, o portal chama a mesma função, não precisa duplicar a lógica.

O que ainda falta (fora do escopo desta sprint, catalogado na auditoria):
nenhum mecanismo de autenticação/sessão para um `SstProvider` existe hoje
(só `User` ligado a `Company`); nenhuma rota checa `providerCanOperate`
para decidir acesso — quando o portal existir, as rotas de
`TrainingClass`/`TrainingParticipant` vão precisar de uma segunda forma de
`requirePermission` (ou equivalente) que aceite uma sessão de prestador,
resolvendo companyId através do `SstProviderCompany` em vez de
`User.companyId`.

## 9. Estratégia para o futuro Portal Colaborador

Sem mudança de modelagem necessária para "Meus treinamentos"/"Minhas
reciclagens": `TrainingParticipant.employeeId` já indexado
(`@@index([employeeId])`, desde a Sprint 2) e `expiresAt` agora também
indexado por empresa (seção 4) — uma query `where: { employeeId }`
(ou `{ employeeId, expiresAt: { lte: X } }` para reciclagens vencendo) já
atende com índice tanto hoje quanto em escala. "Meus certificados" continua
dependendo de um model `TrainingCertificate` que não existe (fora do
escopo desta sprint). Mesma lacuna de autenticação do Portal Consultoria:
não existe hoje nenhuma forma de um `Employee` se autenticar no sistema.
