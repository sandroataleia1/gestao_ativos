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
