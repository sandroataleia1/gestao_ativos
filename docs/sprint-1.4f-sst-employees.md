# Sprint SST 1.4F — Cadastro e gestão de colaboradores pela Consultoria SST

Permite que uma consultoria SST cadastre, edite, inative e reative colaboradores
das empresas que atende — inclusive empresas pré-cadastradas que ainda não
assumiram o Portal Empresa. Os colaboradores continuam pertencendo
exclusivamente à `Company`; a consultoria nunca é proprietária dos dados.

## 1. Propriedade dos dados

`Employee.companyId` continua a única fonte de tenant. Nenhum campo de
`providerId` foi adicionado ao model — rastreabilidade de "quem operou" vive
inteiramente em `AuditLog` (`actorType`/`providerId`), nunca numa coluna do
próprio colaborador. Revogar, suspender ou bloquear a consultoria nunca apaga
ou altera um `Employee` — só impede a consultoria de vê-lo/operá-lo na
próxima requisição. Reivindicar a Company nunca copia ou transfere
colaboradores: Portal Empresa e Portal Consultoria leem exatamente a mesma
linha.

## 2. Matriz de autorização

| Papel \ AccessLevel | VIEW | OPERATION | ADMINISTRATION |
|---|---|---|---|
| OWNER | Somente leitura | Leitura + gestão | Leitura + gestão |
| TECHNICIAN | Somente leitura | Leitura + gestão | Leitura + gestão |
| VIEWER | Somente leitura | Somente leitura | Somente leitura |

"Gestão" = cadastrar/editar/inativar/reativar. Nenhum accessLevel além de
OPERATION/ADMINISTRATION concede escrita; VIEWER nunca gerencia,
independente do accessLevel do vínculo. ADMINISTRATION não concede nenhum
poder além do que OPERATION já concede para `Employee` (não é gestão de
CompanyMembership, usuários empresariais, CNPJ ou billing).

## 3. Estado do vínculo e da Company

Só `SstProviderCompany.status = ACTIVE` concede qualquer acesso (leitura ou
escrita) — PENDING/SUSPENDED/REVOKED/REJECTED bloqueiam os dois.

| `Company.controlStatus` | Leitura | Escrita |
|---|---|---|
| UNCLAIMED (própria consultoria, `authorizationBasis = PROVIDER_PRE_REGISTRATION`) | ✅ | ✅ (conforme accessLevel) |
| UNCLAIMED (qualquer outro caso) | ❌ | ❌ |
| CLAIM_PENDING | ✅ (se vínculo ACTIVE) | ❌ (`COMPANY_CONTROL_REVIEW_IN_PROGRESS`, 409) |
| DISPUTED | ✅ (se vínculo ACTIVE) | ❌ (mesma semântica) |
| CLAIMED | ✅ | ✅ (conforme accessLevel) |

`Company.operationalStatus` (SUSPENDED/CLOSED) bloqueia leitura E escrita,
sempre com mensagem genérica ("Esta empresa não está disponível para
operação no momento.") — nunca revela se é suspensão administrativa ou
encerramento.

## 4. Guards centrais

`lib/sst-auth.ts`:
- `requireSstProviderEmployeeViewAccess(companyId)` — resolve vínculo ACTIVE
  + Company não SUSPENDED/CLOSED. Independe de role/accessLevel/controlStatus
  (CLAIM_PENDING/DISPUTED continuam legíveis).
- `requireSstProviderEmployeeManageAccess(companyId)` — tudo acima, mais
  role ≠ VIEWER, accessLevel ≠ VIEW, e controlStatus fora de
  CLAIM_PENDING/DISPUTED (lança `CompanyControlReviewInProgressError`, 409).
- `sstCanManageEmployees(ctx)` — variante não-lançável para a UI.

Ambos reconsultam o banco a cada chamada (nunca cache de sessão,
`User.companyId` ou `active_company_id`) e nunca confiam em `providerId`
vindo do client — sempre derivado da sessão via `requireSstAuth()`.

## 5. Serviço central (`lib/employees.ts`)

`createEmployeeForCompany`/`updateEmployeeForCompany`/
`deactivateEmployeeForCompany`/`reactivateEmployeeForCompany` —
extraídos do que antes vivia direto nas rotas do Portal Empresa, agora
compartilhados pelos dois portais. Nenhum aceita `companyId`/`providerId` de
um payload não confiável — sempre parâmetro explícito já autorizado pelo
guard do chamador. Duplicidade de documento (`@@unique([companyId,
document])`) vira `ValidationError` amigável, nunca expõe P2002.
Auditoria (`employee.create`/`employee.update`/`employee.delete`/
`employee.reactivate`) agora cobre criação e edição também no Portal Empresa
(antes só a inativação era auditada).

## 6. Documento e privacidade

`Employee.document` continua um campo genérico (nunca validado como CPF —
ver `lib/validations/employee.ts`), sem alteração de contrato. O Portal SST
nunca recebe o valor completo: `lib/sst-employees.ts:maskEmployeeDocument`
mantém só os 2 primeiros/2 últimos caracteres em toda listagem. A edição
mostra o valor real (necessário para corrigi-lo), como já acontecia no
Portal Empresa. `AuditLog` nunca grava o documento, mesmo mascarado —
apenas `targetLabel` (nome) e `metadata.changedFields` (nomes de campo).

## 7. Departamento e cargo

A consultoria só SELECIONA Department/Position já existentes — nenhuma
criação inline no Portal SST (o `QuickCreateLookupDialog` do Portal Empresa
usa rotas `/api/departments`/`/api/positions` protegidas por RBAC do Portal
Empresa, não reaproveitável pela sessão SST). Para uma Company UNCLAIMED sem
nenhum Department/Position ainda, os dois campos continuam opcionais
(já eram, no schema) — o formulário mostra "cadastrados pelo Portal
Empresa" como orientação.

## 8. Rotas e APIs

Página: `/sst/companies/[companyId]/employees` (estendida — já existia
como visão só-leitura de conformidade de treinamento; agora também lista
`documentMasked`/situação ACTIVE-INACTIVE e ações de gestão),
`/employees/new`, `/employees/[employeeId]/edit`.

API: `GET/POST /api/sst/companies/[companyId]/employees`,
`GET/PUT .../[employeeId]`, `POST .../[employeeId]/deactivate`,
`POST .../[employeeId]/reactivate`. Todas as mutações exigem
`requireTrustedMutationOrigin`; nenhum body aceita `companyId`/`providerId`/
`role`/`accessLevel` como autoridade (schema Zod não tem esses campos).
Recurso de outra Company sempre 404.

## 9. Integração com treinamentos e Portal Empresa

Nenhuma tabela nova, nenhuma sincronização: o colaborador criado pela
consultoria é a MESMA linha `Employee` que o módulo de treinamentos e o
Portal Empresa já leem — aparece imediatamente nos dois, sem código extra.

## 10. Riscos e limitações

- Validação manual em navegador segue não executada nesta sessão (mesma
  pendência de todas as sprints anteriores) — ver roteiro no relatório de
  entrega.
- MFA do Super Admin segue ausente (bloqueador de produção já documentado).
- `ADMINISTRATION` e `OPERATION` têm exatamente o mesmo comportamento para
  `Employee` nesta sprint (nenhuma ação exclusiva de ADMINISTRATION foi
  definida no spec) — documentado, não um bug.
- Sem edição em massa/importação — fora de escopo desta sprint.

---

## Sprint SST 1.4F.1 — Hardening de colaboradores, relações organizacionais e privacidade

### 11. Isolamento de Department/Position entre tenants

**Achado da auditoria**: o banco (Postgres/Prisma) **nunca impediu**
`Employee.companyId = A` com `Department.companyId = B` ou
`Position.companyId = B` — `Employee.departmentId`/`positionId` são FKs
simples para `Department.id`/`Position.id`, sem FK composta nem CHECK
amarrando `companyId`. A ÚNICA proteção sempre foi de aplicação:
`lib/employees.ts` (então `assertReferencesBelongToCompany`, criada muito
antes desta sprint para o Portal Empresa e reaproveitada pelo Portal SST na
Sprint 1.4F) — já bloqueava corretamente antes desta sprint. O diagnóstico
(`npm run diagnose:employee-organization`) confirmou **0 inconsistências**
nos 2033 colaboradores existentes.

**O que mudou nesta sprint**: a função foi renomeada para
`validateEmployeeOrganizationReferences({ companyId, departmentId,
positionId, tx })` e **movida para dentro da mesma transação** Prisma do
`create`/`update` (antes rodava como uma consulta separada, ANTES de abrir a
transação — nunca uma corrida real, dado que Department/Position são
imutáveis após criados, mas agora a atomicidade é estrutural, não
presumida). Mensagem de erro unificada: "O setor ou cargo selecionado não
está disponível para esta empresa." — nunca revela qual dos dois campos
falhou, nem que o id pertence a outra empresa, nem P2002/P2025/nome de
constraint.

**Department/Position são imutáveis**: confirmado por auditoria de código —
`app/api/departments/route.ts`/`app/api/positions/route.ts` só têm `POST`
(criação); não existe NENHUM `prisma.department.update`/`delete` (nem
`position.*` equivalente) em toda a aplicação. `companyId` de um
Department/Position nunca muda depois de criado, e nenhum é removido — os
cenários de "referência removida entre validação e gravação" (§13 do spec)
são estruturalmente **inaplicáveis** ao domínio atual, documentado em vez de
testado com um cenário fictício.

**Constraint de banco (`@@unique([id, companyId])` + FK composta)**:
avaliada e **não aplicada nesta sprint** — a proteção de serviço já é
suficiente (0 inconsistências, validação transacional, cobertura de teste
extensa) e uma migration para reforço redundante não tem benefício de defesa
em profundidade que justifique o custo/risco de uma migration nova. Ver
critério do próprio spec (§6): só propor se a proteção de serviço for
insuficiente — não é o caso.

### 12. Política final do documento por papel

O GET de detalhe do Portal SST (`/api/sst/companies/[companyId]/employees/[employeeId]`)
**sempre** mascara o documento — inclusive para OWNER/TECHNICIAN com
accessLevel OPERATION/ADMINISTRATION. Isso não é uma lacuna: esse endpoint
nunca alimenta o formulário de edição (que busca o registro completo
diretamente no servidor, na página `edit/page.tsx`, já atrás de
`requireSstProviderEmployeeManageAccessOrDeny`). "Separar DTO por
capacidade" (spec §8) é resolvido assim — a capacidade de editar nunca passa
por este endpoint de API, só pela página server-rendered com seu próprio
guard.

### 13. Semântica de auditoria da inativação

Auditoria confirmou: `employee.delete` **sempre** representou soft
delete/inativação (única ocorrência em todo o código, dentro de
`deactivateEmployeeForCompany`); **não existe hard delete real** de
`Employee` em nenhum lugar da aplicação (confirmado por busca por
`prisma.employee.delete`/`deleteMany`). Nenhum relatório/filtro depende do
literal `"employee.delete"`. `AuditLog.action` é uma coluna `String` livre
(não um enum Postgres) — renomear não exigiu migration.

Corrigido: `deactivateEmployeeForCompany` agora grava `employee.deactivate`.
`employee.delete` permanece no catálogo (`lib/audit.ts`) só por
compatibilidade de tipo com linhas já gravadas (nenhuma linha histórica foi
migrada). Portal Empresa e Portal SST usam a mesma função (mesmo serviço
compartilhado), logo a mesma semântica automaticamente.

### 14. Diagnóstico de dados existentes

`scripts/diagnose-employee-organization.ts` (mantido como diagnóstico
oficial, `npm run diagnose:employee-organization`, somente leitura) —
resultado nos dados atuais: 2033 colaboradores, 2028 com
departmentId/positionId, **0** com `companyId` divergente do
Department/Position associado, **0** referências órfãs, **0** com
Department/Position inativo associado.

### 15. Limitações desta sprint

- Nenhuma migration foi criada — a proteção de serviço já é suficiente e
  Department/Position são imutáveis (ver §11).
- A opção de "referência removida entre validação e gravação" (§13 do spec)
  não foi testada como cenário de concorrência real porque o domínio não
  permite remoção de Department/Position hoje — documentado, não simulado.
- Validação manual em navegador segue não executada (mesma pendência
  herdada de todas as sprints anteriores).
