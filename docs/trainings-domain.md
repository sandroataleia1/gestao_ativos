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

Certificados, alertas de vencimento/reciclagem, relatórios e as demais
telas do Portal Consultoria (treinamentos/turmas/participantes dentro do
portal) continuam trabalho futuro — ver seções 9 e 10 e
`docs/portal-consultoria.md` (seção "Roadmap"). Relacionado:
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
  `assertReferencesBelongToCompany` (`lib/employees.ts`).
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
| Adicionar participante | ✅ | ✅ | ❌ | ❌ |
| Remover participante | ✅ | ❌ | ❌ | ❌ |
| Registrar presença/resultado/observação | ❌ | ✅ | ✅ | ❌ |

Centralizado em `assertTrainingClassAllows` (`lib/training-participants.ts`).
Remoção antes do início (`SCHEDULED`) é exclusão real da linha — depois
disso, "remover" deixaria de fazer sentido, porque a matrícula já é
histórico (a turma começou); por isso a partir de `IN_PROGRESS` a única
forma de tirar alguém do resultado é registrando `ABSENT`/`FAILED`, nunca
apagando o registro.

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

## 9. Limitações atuais

- Sem `TrainingCertificate` (certificados) ou `TrainingDocument`
  (anexos/lista de presença assinada).
- Sem alertas de vencimento/reciclagem — `TrainingParticipant.expiresAt`
  agora existe e é calculado, mas ainda não há nada lendo esse campo para
  gerar alerta (o dado está pronto para isso, ver seção 10).
- Sem relatórios de treinamento.
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
- Lista de colaboradores ativos no diálogo de "Adicionar participantes" não
  é paginada (busca client-side sobre a lista inteira) — mesma limitação já
  registrada em `docs/performance.md` para listas de apoio com empresas de
  milhares de colaboradores; aceitável para o volume esperado agora, não
  resolvido nesta entrega.

## 10. Próximos passos

Certificados (`TrainingCertificate`, possivelmente reaproveitando o padrão
de `dataUrl` já usado em `CustodyPhoto`/`CustodySignature` para anexos sem
storage externo) e lista de presença assinada; alertas de vencimento/
reciclagem (reaproveitando o padrão "calculado sob demanda, sem tabela
própria" já usado em `lib/alerts.ts` — ver `docs/alerts.md` — agora com
`TrainingParticipant.expiresAt` como fonte real de "quando um colaborador
precisa reciclar"); relatórios de treinamento (reaproveitando os padrões de
`lib/reports.ts`); e, por fim, o Portal Consultoria externo (login/telas
próprias para o prestador — ver `docs/sst-providers.md`, seção 6).
