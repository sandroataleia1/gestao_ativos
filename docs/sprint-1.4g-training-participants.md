# Sprint SST 1.4G — Participantes nas Turmas de Treinamento

Entrega a etapa de **inscrição** de colaboradores em turmas de treinamento,
em ambos os portais (Empresa e Consultoria SST autorizada). Não inclui
presença, resultado, certificado, alertas de vencimento ou qualquer canal de
notificação — isso é escopo da Sprint SST 1.4H. Complementa
`docs/trainings-domain.md` (seções 7, 7.1 e 8, atualizadas nesta sprint).

## 1. Achado da auditoria — a funcionalidade já existia

O objetivo declarado da sprint ("permitir inclusão/remoção de colaboradores
em turmas") **já estava implementado** desde a Sprint 2 (pré-numeração SST):
model `TrainingParticipant`, serviço (`lib/training-participants.ts`), rotas
de ambos os portais e UI de ambos os portais. A sprint foi então tratada como
um **hardening/extensão** de uma funcionalidade real existente, não uma
implementação do zero — nenhum model duplicado foi criado.

Gaps concretos identificados e corrigidos:

| Responsabilidade | Arquivo atual | Regra encontrada | Alteração necessária |
|---|---|---|---|
| Remoção de participante | `lib/training-participants.ts` | Hard delete quando `SCHEDULED` | Remoção lógica (`enrollmentStatus: CANCELLED`), nunca apaga a linha |
| Reentrada | `lib/training-participants.ts` | Inexistente (removido = como se nunca tivesse existido) | Reativa a mesma linha (`enrollTrainingClassParticipants`/`reactivateTrainingClassParticipant`) |
| Porta de status "adicionar" | `lib/training-participants.ts` | Permitia `SCHEDULED` e `IN_PROGRESS` | Restrita a `SCHEDULED` (execução é 1.4H) |
| Redução de capacidade | `lib/training-classes.ts` | Sem checagem — podia reduzir abaixo dos inscritos | `assertCapacityReductionAllowed`, sob lock de linha |
| Guard Portal SST | `lib/sst-auth.ts` | Só checava vínculo ACTIVE, sem estado da Company nem isolamento de consultoria | `requireSstTrainingParticipantViewAccess`/`ManageAccess`, com `controlStatus`/`operationalStatus`/`assertProviderManagesCompanyTraining` |
| CSRF Portal SST | rotas `app/api/sst/companies/[companyId]/classes/[classId]/participants/**` | Ausente | `requireTrustedMutationOrigin` em todas as mutações |
| Seletor de colaboradores | ambos os portais | Carregava todos os `Employee` ACTIVE da empresa de uma vez | `listEligibleEmployeesForTrainingClass` paginado + busca server-side |
| Documento na listagem (Portal SST) | página de detalhe da turma | `getParticipantsForClass` renderizado sem mascarar (só a rota GET mascarava, a página não) | Documento mascarado também no server render da página |
| Cobertura de teste | — | Nenhum teste dedicado a este domínio | 60 testes novos (`tests/tenant-isolation/training-participants.test.ts`) |

## 2. Modelo de dados

Nenhum model novo. `TrainingParticipant` ganhou:

```prisma
enum TrainingParticipantEnrollmentStatus {
  ENROLLED
  CANCELLED
}

enrollmentStatus TrainingParticipantEnrollmentStatus @default(ENROLLED)
cancelledAt       DateTime?
```

- `enrollmentStatus` é **ortogonal** a `attendanceStatus`/`resultStatus` —
  responde "está inscrito?", não "o que aconteceu durante a turma?".
  Deliberadamente sem qualquer termo de presença no nome (reservado para a
  1.4H).
- `createdAt` sempre preserva a primeira inscrição histórica; `enrolledAt` é
  atualizado a cada reativação; `cancelledAt` só é preenchido enquanto
  `CANCELLED`.
- CHECK manual (migração `20260717121934_training_participant_enrollment_status`):
  `cancelledAt` preenchido se e somente se `enrollmentStatus = CANCELLED`.
- A unicidade pré-existente `@@unique([companyId, trainingClassId, employeeId])`
  é o que torna a reentrada "mesma linha" a única opção possível — uma
  segunda linha para o mesmo par turma+colaborador é sempre rejeitada pelo
  banco.

Migração puramente aditiva, aplicada em dev e no banco de teste
(`gestao_ativos_test`); nenhum backfill de dado — todo `TrainingParticipant`
existente já nasce `ENROLLED` pelo `@default`, que é exatamente o estado que
ele já representava implicitamente antes desta sprint.

## 3. Concorrência

Capacidade (`maximumParticipants`) é protegida por um lock pessimista
(`SELECT ... FOR UPDATE` na linha da `TrainingClass`) dentro da mesma
transação que conta os `ENROLLED` atuais e grava a inscrição — sem esse
lock, duas inscrições concorrentes em Read Committed (padrão do Postgres)
poderiam ambas contar a mesma capacidade disponível antes de qualquer uma
comitar, estourando o limite. O mesmo lock é usado por
`updateTrainingClass` ao reduzir `maximumParticipants`, serializando contra
inscrições simultâneas. Turmas diferentes não se bloqueiam entre si.

Cenários cobertos por teste: última vaga disputada por dois colaboradores
diferentes, mesmo colaborador inscrito duas vezes simultaneamente (a
unicidade do banco nunca vaza como erro não tratado), lote concorrente
disputando vagas insuficientes, e redução de capacidade concorrente com uma
inscrição.

## 4. Autorização

**Portal Empresa**: `training:view` (leitura) / `training:manage`
(inclusão/remoção/reativação) — RBAC existente, sem papéis novos.

**Portal SST**: `requireSstTrainingParticipantViewAccess`/`ManageAccess`
(`lib/sst-auth.ts`), reaproveitando a base `resolveSstCompanyAccessState`
já usada para colaboradores (Sprint SST 1.4F.1):

- Leitura: qualquer vínculo `ACTIVE`, independente de papel/`accessLevel`;
  bloqueada só se a Company estiver `SUSPENDED`/`CLOSED`.
- Gestão: papel diferente de `VIEWER`, `accessLevel` `OPERATION` ou
  `ADMINISTRATION`, Company fora de `CLAIM_PENDING`/`DISPUTED`
  (`CompanyControlReviewInProgressError`), **e** a consultoria precisa ser
  quem gerencia especificamente aquele `CompanyTraining`
  (`assertProviderManagesCompanyTraining` — mesma checagem já usada por
  turma/`CompanyTraining` desde antes desta sprint, agora também aplicada a
  participantes). Uma consultoria com `OPERATION` na empresa mas que não
  gerencia aquele treinamento específico só lê, nunca inscreve/remove.

## 5. Privacidade

Documento do colaborador sempre mascarado no Portal SST — nas duas rotas de
listagem (`GET participants`, `GET eligible-employees`), na resposta de
`POST`/`DELETE`/`reactivate`, e agora também no server render da página de
detalhe da turma (gap encontrado e corrigido nesta sprint, já que a página
chamava o serviço diretamente em vez de passar pela rota mascarada).

## 6. Testes e quality gate

- 60 testes novos (`tests/tenant-isolation/training-participants.test.ts`):
  invariantes de schema, isolamento cross-tenant, semântica de inscrição
  (idempotência/reentrada/nunca hard-delete), portas de status, capacidade
  (inclusive redução), concorrência, matriz de autorização Portal SST
  (papel × accessLevel × vínculo × estado da Company × isolamento entre
  consultorias), privacidade, CSRF e regressão.
- Suíte completa: 713/713 (baseline de 653 + 60 novos), `tsc --noEmit`
  limpo, `npm run build` limpo, `prisma validate`/`migrate status` sem
  drift, os 3 diagnósticos read-only sem inconsistência nova, seed de
  demonstração SST rodado duas vezes com resultado idêntico (idempotente).

## 7. Fora do escopo (Sprint SST 1.4H)

Presença, ausência, justificativa, resultado, aprovação/reprovação,
conclusão, certificado, assinatura de lista de presença, upload de
evidências, avaliação/nota, validade/renovação, alertas de vencimento,
qualquer canal de notificação (e-mail/WhatsApp/push/WebSocket), importação
em massa, Portal Colaborador, billing, papéis/níveis de acesso novos, MFA e
deploy.
