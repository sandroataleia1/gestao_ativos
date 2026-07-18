# Domínio: Treinamentos

Documento cumulativo do módulo de Treinamentos, atualizado a cada sprint.

- **Sprint 0** entregou a fundação do catálogo: `TrainingTemplate`
  (global) + `CompanyTraining` (por empresa) — seções 1 a 5.
- **Sprint 1** entregou `TrainingClass` (turmas executáveis de um
  `CompanyTraining`) — seção 6.
- **Sprint 2** entregou `TrainingParticipant` (colaboradores matriculados
  numa turma, com presença/resultado/vencimento) — seção 7.
- **Preparação arquitetural para consultoria SST** adicionou
  `managementMode`/`managedByProviderId` a `CompanyTraining` e os models
  `SstProvider`/`SstProviderCompany` — seção 8, detalhado em
  `docs/sst-providers.md`.
- **Sprint 2.5 (hardening)** adicionou audit trail, máquina de estados de
  `TrainingClass`, correção de concorrência em `addParticipants`, dois
  índices de escalabilidade e o `TrainingAuthorizationResolver` — nenhuma
  funcionalidade nova para o usuário, só fortalecimento arquitetural.
  Detalhado em `docs/training-architecture.md`.
- **Sprint Comercial 1.1** entregou a fundação do Portal Consultoria SST
  (`/sst`) — login próprio da consultoria (`SstProviderUser`), dashboard e
  visão por empresa com indicadores de conformidade calculados sob
  demanda, somente leitura. Detalhado em `docs/portal-consultoria.md`.
- **Sprint SST 1.4G** entregou a etapa de **inscrição** de participantes em
  ambos os portais (Empresa e Consultoria SST): remoção passou a ser
  lógica (nunca mais apaga a linha), reentrada antes do início da turma
  reaproveita a mesma inscrição, capacidade passou a ser protegida também
  contra redução abaixo do número de inscritos, e a porta de "adicionar"
  foi restrita a `SCHEDULED` (antes também permitia `IN_PROGRESS`). Ver
  seção 7.1.
- **Sprint SST 1.4H, fatia 1** entregou alertas de vencimento de
  treinamento (`getTrainingExpiryAlerts`, ver `docs/alerts.md`) — só Portal
  Empresa.
- **Sprint SST 1.4H, fatia 2** entregou certificado individual e lista de
  presença assinada (`TrainingClassDocument`/`TrainingClassSignature`) — só
  Portal Empresa, só HTML (sem PDF), sem assinatura remota. Detalhado em
  `docs/training-documents.md`.
- **Sprint SST 1.4H, fatia 3** entregou o relatório de treinamento
  (`getTrainingsReport`, ver `docs/reports.md`) — 5ª aba de `/reports`,
  mesmo padrão dos 4 relatórios já existentes, nenhum model novo.

Geração de PDF, assinatura remota e as telas equivalentes no Portal
Consultoria continuam trabalho futuro — ver seções 9
e 10 e `docs/portal-consultoria.md` (seção "Roadmap"). Relacionado:
`docs/auth-rbac.md` (RBAC), `docs/alerts.md`, `docs/reports.md`,
`docs/sst-providers.md`, `docs/training-architecture.md` (padrões que este
módulo vai reaproveitar mais adiante) e `docs/portal-consultoria.md` (Portal
Consultoria SST).

## 1. Por que dois modelos: `TrainingTemplate` vs `CompanyTraining`

- **`TrainingTemplate`** é o catálogo global, mantido pela plataforma — não
  pertence a nenhuma empresa (sem `companyId`). Representa modelos prontos
  de treinamento (Integração, NR-01, NR-05, ..., NR-35, Brigada, Primeiros
  Socorros).
- **`CompanyTraining`** é o que a empresa realmente usa — sempre com
  `companyId` obrigatório, sempre derivado da sessão autenticada (nunca do
  client).
- **Cópia, não referência**: criar um `CompanyTraining` a partir de um
  `TrainingTemplate` copia os campos uma única vez, no momento da criação.
  A partir daí os dois registros são totalmente independentes: editar o
  `CompanyTraining` nunca altera o `TrainingTemplate` de origem, e uma
  atualização futura do `TrainingTemplate` (ex.: mudança na carga horária
  sugerida de uma NR) nunca propaga automaticamente para os
  `CompanyTraining` já criados a partir dele. Essa é uma decisão
  deliberada: depois de personalizado, o treinamento é 100% da empresa.

## 2. Catálogo global vs treinamento da empresa

- `TrainingTemplate` é **somente leitura via API** nesta sprint —
  `GET /api/training-templates`, protegido por `training:view`. Não existe
  endpoint (nem UI) para criar/editar/desativar um template; a manutenção
  do catálogo inicial é via `prisma/seed.ts` (idempotente — editar a lista
  e rodar o seed de novo resincroniza os campos descritivos dos templates
  já existentes).
- `CompanyTraining` tem CRUD completo (criar, listar, editar,
  desativar) via `/api/trainings`, protegido por `training:view` (leitura)
  e `training:manage` (escrita). "Excluir" na UI é sempre soft delete
  (`active: false`) — a linha nunca é removida, mesmo padrão de `Employee`.

## 3. Como o versionamento (`version`) será usado no futuro

- `TrainingTemplate.version`: reservado para publicar uma nova versão de um
  mesmo `code` de treinamento (ex.: mudança regulatória numa NR) sem
  quebrar o histórico de `CompanyTraining` já criados a partir da versão
  anterior — a modelagem exata (nova linha com `code` igual e `version`
  incrementado, ou bump in-place com trilha própria) fica para quando essa
  necessidade aparecer de fato.
- `CompanyTraining.version`: reservado para uma futura revisão do próprio
  treinamento da empresa (ex.: a empresa muda a carga horária e quer manter
  o histórico do que valia antes). Nesta sprint todo registro nasce com
  `version: 1` e nada incrementa esse contador ainda.
- Nenhum dos dois é exposto no formulário principal da UI — é campo
  técnico, oculto por enquanto (ver requisito de UX original).

## 4. Como isso viabiliza um técnico de SST interno

`category`, `nrReference`, `requiresExam`/`minimumPassingGrade` e
`instructorType` já modelam o vocabulário que um técnico de SST usa no
dia a dia (referência normativa, carga horária, exigência de avaliação,
quem pode ministrar) — sem ainda amarrar a nenhuma agenda ou turma. O
objetivo desta sprint é permitir que esse técnico monte o catálogo da
empresa (a partir dos modelos prontos ou do zero) antes de existir
qualquer agendamento de fato.

## 5. Como isso vai suportar um futuro Portal SST externo

`CompanyTraining` já carrega tudo que uma consultoria externa de SST
precisaria enxergar/gerenciar por empresa (treinamentos obrigatórios,
vigência, carga horária, exigências de certificado/assinatura/avaliação).
O desenho de "portal" propriamente dito — autenticação separada, vínculo
consultoria↔empresa, criação de colaboradores pela consultoria — é
despriorizado explicitamente para depois (ver seção 6), mas o modelo de
dados atual não impede essa extensão futura: um vínculo de consultoria, por
exemplo, pode ser modelado como uma tabela nova relacionando `Company` a
uma entidade de consultoria, sem precisar alterar `CompanyTraining`.

## 6. Turmas (`TrainingClass`) — Sprint 1

Transforma um `CompanyTraining` em algo executável: uma turma agendada, com
data, local, instrutor e capacidade.

- `TrainingClass.companyTrainingId` é obrigatório e sempre validado como
  pertencente à empresa atual e `active` (`assertCompanyTrainingBelongsToCompany`,
  `lib/training-classes.ts`) — mesmo raciocínio de isolamento de
  `validateEmployeeOrganizationReferences` (`lib/employees.ts`).
- **Nunca é apagada** — não existe `DELETE /api/training-classes/[id]`. O
  ciclo de vida é só `status`: `SCHEDULED` (nasce assim, sempre — o wizard
  de criação não tem etapa de status) → `IN_PROGRESS` → `COMPLETED`, ou
  `CANCELLED` a qualquer momento. "Cancelar turma" na UI é um `PUT` que só
  troca o `status`, nunca uma exclusão.
- `location`/`internalInstructor`/`externalInstructor` são texto livre —
  `location` não referencia o model `Location` (aquele é rastreamento
  físico de ativos, um domínio diferente); os instrutores não têm vínculo
  com `Employee` nesta sprint, só o nome em texto.
- UI: `/trainings/classes` tem um painel resumo (contagem por status +
  próximas turmas agendadas) acima da listagem — painel local desta tela,
  não o dashboard geral do app (`app/(app)/dashboard`). Criação usa um
  wizard de 5 passos (Treinamento → Data → Local → Instrutor → Capacidade);
  edição é um formulário único (inclui trocar o `status`).

## 7. Participantes (`TrainingParticipant`) — Sprint 2

Conecta uma turma a colaboradores reais, com presença, aprovação/reprovação
e cálculo de vencimento.

### Por que participante é sempre um `Employee`

`TrainingParticipant.employeeId` é obrigatório e sempre um `Employee` já
cadastrado na empresa — **não existe convidado externo, nem model de
"pessoa externa"**. Decisão deliberada, não uma limitação temporária: tanto
o técnico SST interno quanto um futuro Portal SST vão sempre operar sobre
colaboradores que já existem no sistema (cadastrados pela própria empresa
ou, futuramente, por uma consultoria autorizada — mas ainda como
`Employee`, nunca como uma entidade paralela). Isso mantém uma única fonte
de verdade para "quem é colaborador desta empresa", reaproveitada por todo
o resto do sistema (custódia, movimentações, agora treinamento).

### Portas de status — o que é permitido em cada momento da turma

| Ação | SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED |
|---|---|---|---|---|
| Adicionar/reativar participante | ✅ | ❌ | ❌ | ❌ |
| Remover participante (lógico) | ✅ | ❌ | ❌ | ❌ |
| Registrar presença/resultado/observação | ❌ | ✅ | ✅ | ❌ |

Centralizado em `assertTrainingClassAllows` (`lib/training-participants.ts`),
erro semântico `TRAINING_CLASS_PARTICIPANTS_LOCKED` (nunca revela qual regra
específica bloqueou — mesma mensagem para adicionar/remover fora de
`SCHEDULED`). **Mudança na Sprint SST 1.4G**: até então (Sprint 2),
"adicionar" também era permitido com a turma `IN_PROGRESS` ("alguém chega
atrasado"); esta sprint restringe deliberadamente para escopo de inscrição
(execução/presença fica para a Sprint SST 1.4H) — ver seção 7.1.

### 7.1. Inscrição, remoção lógica e reentrada (Sprint SST 1.4G)

Até a Sprint 2, remover um participante com a turma ainda `SCHEDULED` era
uma exclusão real da linha (`DELETE`) — considerado aceitável porque "a
turma ainda nem começou, não é histórico ainda". A Sprint SST 1.4G **reverte
essa decisão**: nenhuma remoção apaga a linha, mesmo antes do início da
turma, para que uma reentrada (colaborador removido por engano, ou que
volta a participar antes da turma começar) reaproveite a mesma inscrição em
vez de criar uma segunda.

- `TrainingParticipant.enrollmentStatus` (`ENROLLED`/`CANCELLED`) é um campo
  **novo e ortogonal** a `attendanceStatus`/`resultStatus` — "a pessoa está
  inscrita nesta turma" é uma pergunta diferente de "o que aconteceu com ela
  durante/depois da turma" (essa segunda continua escopo da Sprint SST
  1.4H). Nome deliberadamente evita qualquer termo de presença.
- **Remover** (`cancelTrainingClassParticipant`) marca `CANCELLED` +
  `cancelledAt`; nunca apaga a linha. Idempotente (remover quem já está
  `CANCELLED` é no-op, sem nova auditoria).
- **Reentrada** (mesmo fluxo de "adicionar", via
  `enrollTrainingClassParticipants`): se o colaborador já teve uma inscrição
  `CANCELLED` nesta turma, ela é reativada (mesma linha, `enrolledAt`
  atualizado, `cancelledAt` zerado) — nunca cria uma segunda linha.
  `createdAt` preserva sempre a primeira inscrição histórica. Reativação
  também pode ser explícita a partir da própria listagem de participantes
  (`reactivateTrainingClassParticipant`), sem passar pelo seletor de
  colaboradores.
- **Idempotência**: inscrever quem já está `ENROLLED` não cria linha nem
  gera nova auditoria (contabilizado como `alreadyEnrolled` na resposta).
- A unicidade `@@unique([companyId, trainingClassId, employeeId])` no banco
  (pré-existente) é a rede de segurança que torna a reentrada "mesma linha"
  a única opção possível — uma segunda linha para o mesmo par
  turma+colaborador é sempre rejeitada pelo banco, nunca só pela regra de
  negócio.
- Um `CHECK` de banco (migração
  `20260717121934_training_participant_enrollment_status`) garante
  `cancelledAt` preenchido se e somente se `enrollmentStatus = CANCELLED`.
- **Capacidade** (`maximumParticipants`) só conta inscrições `ENROLLED` —
  uma `CANCELLED` nunca ocupa vaga, liberando espaço para outro colaborador.
  A checagem roda dentro de uma transação que trava a linha da
  `TrainingClass` (`SELECT ... FOR UPDATE`) antes de contar/gravar, para que
  duas inscrições concorrentes nunca estourem o limite (Read Committed do
  Postgres, sem o lock, permitiria que ambas contassem a mesma capacidade
  disponível antes de qualquer uma comitar).
- **Redução de capacidade**: editar `maximumParticipants` de uma turma
  (`updateTrainingClass`) para um valor menor que o número de inscritos
  `ENROLLED` é bloqueado (`assertCapacityReductionAllowed`), sob o mesmo
  lock de linha — mesmo sob concorrência com uma inscrição simultânea.
- Colaborador inativado (`Employee.status != ACTIVE`) nunca pode ser
  inscrito nem reativado numa turma; uma inscrição já existente não é
  desfeita automaticamente por causa disso — a UI mostra um aviso
  ("Colaborador inativo") na listagem.

### Regras de presença e resultado

- `attendanceStatus`: `ENROLLED` (ainda não registrado) → `PRESENT` ou
  `ABSENT`.
- `resultStatus`: `PENDING` → `APPROVED` ou `FAILED`.
- Ao aprovar (`APPROVED`) **ou** reprovar (`FAILED`), `completedAt` é
  sempre setado (`now()` ou o valor enviado pelo client, para permitir
  corrigir/backdatar) — marca quando a avaliação terminou, independente do
  resultado. `expiresAt` só é calculado para `APPROVED`:
  `completedAt` + `CompanyTraining.validityMonths` meses (`addMonths` em
  `lib/training-participants.ts`), ou `null` se `validityMonths` for
  nulo/zero (treinamento sem validade definida). Voltar `resultStatus` para
  `PENDING` reseta `completedAt`/`expiresAt` para `null`.
- A atualização (`PUT`) é **parcial** — só mexe nos campos presentes no
  payload —, diferente do padrão full-replace de `CompanyTraining`/
  `TrainingClass`: a UI dispara ações separadas (marcar presença, marcar
  resultado, editar observação), então forçar o payload inteiro a cada
  ação seria mais fricção sem ganho nenhum.
- Capacidade (`maximumParticipants`) e duplicidade são checadas na adição
  (`addParticipants`), dentro de uma transação — evita condição de corrida
  entre duas adições concorrentes na mesma turma. A unicidade
  `@@unique([companyId, trainingClassId, employeeId])` no banco é a rede de
  segurança por trás da checagem de negócio.

## 8. Gestão interna vs. consultoria SST externa

`CompanyTraining` ganhou `managementMode` (`INTERNAL` | `EXTERNAL_PROVIDER`)
e `managedByProviderId` — quem opera o treinamento no dia a dia, sem afetar
a propriedade (continua sempre da empresa). Detalhado em
`docs/sst-providers.md`; resumo:

- `SstProvider` é a única tabela do domínio sem `companyId` (global, pensado
  para o futuro Portal Consultoria); o isolamento por empresa vem do
  vínculo `SstProviderCompany`, nunca de `SstProvider` direto.
- Só um vínculo `ACTIVE` com `accessLevel` `OPERATION`/`ADMINISTRATION`
  permite escolher aquele prestador como `managedByProviderId` — validado
  em `assertManagementModeValid` (`lib/trainings.ts`), chamado no
  `POST`/`PUT` de `/api/trainings`.
- Gestão dos prestadores (criar, autorizar, suspender, revogar) fica em
  `/configuracoes/sst-providers`, atrás de `sst_provider:view`/
  `sst_provider:manage` (permissões novas, reaproveitando o mesmo padrão de
  RBAC do resto do sistema).
- Ainda **não existe** login/portal/usuário de consultoria — a gestão do
  vínculo é inteiramente do lado da empresa nesta etapa.
- **Isolamento entre consultorias na gestão de participantes** (Sprint SST
  1.4G): `requireSstTrainingParticipantManageAccess`
  (`lib/sst-auth.ts`) reaproveita `assertProviderManagesCompanyTraining`
  (`lib/sst-trainings.ts`, já usada por turma/`CompanyTraining` desde antes
  desta sprint) — só a consultoria que gerencia aquele `CompanyTraining`
  especificamente (`managementMode: EXTERNAL_PROVIDER` +
  `managedByProviderId`) pode incluir/remover/reativar participantes.
  Leitura é deliberadamente mais permissiva: qualquer vínculo `ACTIVE` com a
  empresa enxerga participantes de qualquer turma (mesma política já usada
  na listagem de turmas).

## 9. Limitações atuais

- Certificado e lista de presença assinada existem só como HTML — sem
  geração de PDF, sem assinatura remota (WhatsApp/token público) e só no
  Portal Empresa (nenhum equivalente no Portal Consultoria SST ainda). Ver
  `docs/training-documents.md`.
- Sem `/sst` (Portal SST externo).
- Sem agenda (calendário) — `TrainingClass` guarda data/hora, mas não há
  visão de calendário na UI, só a lista com painel resumo.
- Vínculo de consultoria SST existe (seção 8), mas sem portal/login de
  consultoria nem criação de colaboradores pela consultoria — a gestão do
  vínculo é só do lado da empresa.
- Sem cobrança.
- Sem regras complexas por cargo/setor — RBAC continua só `training:view` /
  `training:manage`, igual para todo o módulo (catálogo, turmas e
  participantes).
- `TrainingTemplate` é somente leitura via API — toda manutenção do
  catálogo inicial é via seed/banco, sem UI.
- Evidências e avaliação/nota (`minimumPassingGrade`/`requiresExam`)
  continuam fora de escopo — nenhum código ainda os usa.

## 10. Próximos passos

**Entregue (Sprint SST 1.4H, fatia 1)**: alertas de vencimento/reciclagem —
`getTrainingExpiryAlerts` (`lib/alerts.ts`) lê `TrainingParticipant.expiresAt`
e segue o mesmo padrão "calculado sob demanda, sem tabela própria" já usado
para CA/custódia/estoque (ver `docs/alerts.md`).

**Entregue (Sprint SST 1.4H, fatia 2)**: certificado individual e lista de
presença assinada (`lib/training-documents.ts`,
`docs/training-documents.md`) — mesmo padrão de
`CustodyDocument`/`CustodySignature` (`docs/custody-documents.md`), só
Portal Empresa, só HTML.

**Entregue (Sprint SST 1.4H, fatia 3)**: relatório de treinamento
(`getTrainingsReport`, `lib/reports.ts`) — 5ª aba de `/reports`, mesmo
padrão dos 4 relatórios já existentes (`{ rows, summary }`, filtros na
query string, export CSV client-side).

**Pendente**: geração de PDF (`pdfUrl` já preparado, nunca preenchido);
assinatura remota (WhatsApp/token público, mesmo padrão de
`CustodySignatureRequest`/`app/assinar/[token]`); os mesmos dois documentos
no Portal Consultoria SST; relatórios de treinamento (reaproveitando os
padrões de `lib/reports.ts`); e, por fim, o Portal Consultoria externo (login/telas
próprias para o prestador — ver `docs/sst-providers.md`, seção 6).
