# Prestadores SST (consultoria externa) — preparação arquitetural

Esta etapa adiciona a base de dados e as telas do lado da empresa para
autorizar uma consultoria/prestador de Segurança do Trabalho a gerenciar
treinamentos em nome da empresa. **Não implementa** o futuro Portal
Consultoria (login/telas separadas para o prestador acessar) — só o
necessário para a empresa cadastrar, autorizar, suspender e revogar esse
acesso. Ver seção 6 para o que fica de fora.

## 1. Propriedade vs. gestão

- **Propriedade**: todo `CompanyTraining` sempre pertence à empresa
  (`companyId` obrigatório, nunca muda). Isso não é afetado por nada desta
  etapa.
- **Gestão**: quem opera o treinamento no dia a dia — `managementMode`
  (`INTERNAL` ou `EXTERNAL_PROVIDER`) e, se `EXTERNAL_PROVIDER`,
  `managedByProviderId` apontando para o `SstProvider` responsável.

Uma consultoria autorizada **gerencia**, nunca **é dona** do treinamento. Se
o vínculo for revogado, o `CompanyTraining` continua existindo e pertencendo
à empresa — só passa a precisar de um novo responsável (interno ou outro
prestador).

## 2. Por que `SstProvider` não tem `companyId`

Diferente de todo outro model de negócio deste sistema, `SstProvider` é
**global** (sem `companyId`) — de propósito: no futuro Portal Consultoria,
uma mesma consultoria pode atender várias empresas, cada uma com seu
próprio nível de acesso e status. O isolamento multi-tenant não vem de
`SstProvider`, vem inteiramente de `SstProviderCompany` (o vínculo):

- Toda leitura do lado da empresa (`GET /api/sst-providers`) retorna
  vínculos, com o provider aninhado — nunca uma lista global de
  `SstProvider`.
- Criar um prestador pela tela da empresa (`POST /api/sst-providers`) cria
  as duas linhas juntas (`SstProvider` + `SstProviderCompany` com
  `status: PENDING`) na mesma transação. Não existe, nesta etapa, um fluxo
  de "buscar prestador já cadastrado por outra empresa e vincular" — cada
  empresa cria seu próprio registro, mesmo que na vida real seja a mesma
  consultoria. Deduplicação/reuso entre empresas fica para quando o Portal
  Consultoria existir de fato.

## 3. Regras do vínculo (`SstProviderCompany`)

- `@@unique([providerId, companyId])` — um provider tem no máximo um
  vínculo por empresa.
- `status`: `PENDING` (recém-criado, ainda sem autorização) → `ACTIVE`
  (autorizado, pode gerenciar) → `SUSPENDED` (acesso pausado, reversível) ou
  `REVOKED` (definitivo — não existe "reativar um revogado", seria
  necessário cadastrar o vínculo de novo). Só `ACTIVE` conta para qualquer
  regra de autorização.
- `accessLevel`: `VIEW`, `OPERATION` ou `ADMINISTRATION`. **`VIEW` nunca
  gerencia treinamento** — só `OPERATION`/`ADMINISTRATION` podem ser
  escolhidos como `managedByProviderId` de um `CompanyTraining`. A
  distinção entre `OPERATION` e `ADMINISTRATION` fica para uma etapa
  futura (quando o Portal Consultoria definir o que cada nível
  efetivamente libera); nesta entrega as duas têm o mesmo efeito prático
  (podem gerenciar).
- `approvedByUserId`/`approvedAt` são preenchidos quando o vínculo vira
  `ACTIVE`; `revokedAt`, quando vira `REVOKED`.

## 4. Validação ao criar/editar `CompanyTraining`

Centralizada em `assertManagementModeValid` (`lib/trainings.ts`), chamada
tanto no `POST` quanto no `PUT` de `/api/trainings`:

- `managementMode: INTERNAL` → `managedByProviderId` é sempre forçado a
  `null` no servidor, **mesmo que o client mande um valor** — o servidor
  nunca confia no client para essa decisão (mesmo raciocínio já usado para
  `companyId` em toda API do sistema).
- `managementMode: EXTERNAL_PROVIDER` → confere, nesta ordem: o provider
  existe e está `active`; existe `SstProviderCompany` com `status: ACTIVE`
  entre ele e a empresa da sessão; `accessLevel` é `OPERATION` ou
  `ADMINISTRATION`. Qualquer falha vira um erro 400 com mensagem amigável
  (`ValidationError`, `lib/api-errors.ts`).

## 5. Permissões

`sst_provider:view` / `sst_provider:manage` (nomenclatura com underscore,
não hífen — ver nota abaixo). Matriz:

| Papel | view | manage |
|---|---|---|
| ADMIN | ✅ | ✅ |
| TECNICO_SST | ✅ | ✅ |
| RH | ✅ | — |
| GESTOR | ✅ | — |
| ALMOXARIFADO | — | — |
| CONSULTA | — | — |

`ALMOXARIFADO` e `CONSULTA` não têm nenhuma permissão de prestador SST:
dados de prestador são administrativos/de relacionamento com fornecedor de
serviço — mesma categoria de `Supplier`/`Manufacturer`/gestão de usuários,
que nenhum dos dois papéis também gerencia ou visualiza hoje (`CONSULTA`,
por exemplo, não tem nenhuma permissão de fornecedor/fabricante apesar de
ver ativos que os referenciam — leitura do domínio de ativos não é a mesma
coisa que visibilidade sobre configuração administrativa).

**Nota de nomenclatura**: a especificação original pedia
`sst-provider:view`/`sst-provider:manage` (hífen), mas toda permissão
multi-palavra já existente no projeto usa underscore (`asset_unit:view`,
`asset_unit:manage` — ver `lib/permissions.ts`). Seguimos o padrão do
projeto: `sst_provider:view` / `sst_provider:manage`.

## 6. Preparação para o futuro Portal Consultoria

O que já existe e não precisa mudar quando o portal for construído:
`SstProvider` (global, pode servir várias empresas), `SstProviderCompany`
(vínculo com status/nível de acesso/aprovação), e a marcação de qual
`CompanyTraining` cada prestador gerencia. O que falta, todo fora de escopo
aqui:

- Login/autenticação de consultoria (hoje só usuários da própria empresa
  logam no sistema — `User.companyId` é sempre de uma única empresa).
- Um "usuário de consultoria" — hoje não existe nenhum tipo de usuário
  ligado a `SstProvider`; quem autoriza/gerencia o vínculo é sempre um
  usuário da empresa.
- Portal `/sst` com telas próprias para o prestador operar (hoje ele não
  tem UI nenhuma — a gestão do vínculo é 100% do lado da empresa).
- Agenda, participantes, certificados ou relatórios específicos da
  consultoria.
- Cobrança da consultoria.
- Criação de colaboradores pela consultoria (colaboradores continuam só
  cadastrados pela própria empresa).

## 7. Limitações desta etapa

- Sem portal/login/usuário de consultoria (seção 6).
- `accessLevel OPERATION` vs. `ADMINISTRATION` não têm diferença de
  comportamento ainda — os dois liberam gerenciar treinamento igualmente;
  a distinção fica para quando houver mais ações delegáveis ao prestador.
- Suspender/revogar um vínculo **não** desfaz automaticamente
  `managementMode: EXTERNAL_PROVIDER` dos `CompanyTraining` já configurados
  para aquele prestador — o treinamento continua marcado como gerenciado
  por ele mesmo sem vínculo ativo, até alguém editar manualmente o
  treinamento (decisão deliberada: revogar o acesso de um prestador não
  deve reescrever silenciosamente a configuração de treinamentos já
  existentes; a tela de edição vai deixar isso visível quando o vínculo não
  estiver mais `ACTIVE`).
- Sem dedup entre empresas — cada empresa cria seu próprio `SstProvider`,
  mesmo que seja a mesma consultoria de verdade usada por outra empresa
  (ver seção 2).
