# ADR-001 — Multitenancy e resolução de contexto empresarial

- **Status:** Aceito (revisado na Sprint Arquitetural 0.2; §1.1 adicionada na
  revisão 2 da Migration M1, após correção de divergência)
- **Data:** 2026-07-10
- **Contexto do produto:** Plataforma "Patrium" (gestão de ativos B2B) + Portal
  Consultoria SST. Ver `docs/AUDITORIA-CONTINUIDADE-SST.md`.

> Nota de versão: este ADR foi **criado** na Sprint 0.2 (não existia arquivo ADR
> no repositório antes desta sprint) já contemplando as decisões abaixo. As
> seções marcadas com **(FUTURO)** descrevem o alvo arquitetural e ainda **não
> têm código** — nenhum comportamento da aplicação foi alterado nesta sprint.

---

## 1. Decisão central

O **tenant** (empresa) de qualquer dado de negócio é sempre resolvido **no
servidor**, a partir da identidade autenticada — nunca de um valor enviado pelo
cliente (body, query, params, header, cookie).

Hoje isso se materializa assim:

- **Portal Empresa** (`app/(app)/**`, `app/api/**`): o tenant vem de
  `User.companyId`, lido da sessão Better Auth em `requireCompany()`
  (`lib/auth-server.ts`). Toda query de negócio filtra por esse `companyId`.
- **Portal Consultoria SST** (`app/sst/**`, `app/api/sst/**`): o tenant é o
  `SstProvider`, resolvido em `requireSstAuth()` (`lib/sst-auth.ts`) a partir de
  `SstProviderUser` — **nunca** de `User.companyId`. O acesso a uma empresa
  específica é revalidado em `requireSstProviderCompanyAccess()` exigindo um
  vínculo `SstProviderCompany` com `status = ACTIVE`.

Os dois portais compartilham a mesma tabela `User`/`Session`, mas cada um
resolve o tenant a partir de uma tabela diferente e independente.

---

## 1.1 Enums de ciclo de vida da `Company` (Migration M1)

> Adicionada na revisão 2 da M1: a proposta inicial usava `PRE_REGISTERED`
> como valor de `CompanyControlStatus` e `PROVIDER_PRE_REGISTRATION` como valor
> de `CompanyOrigin`, conflando os dois eixos abaixo. Esta seção fixa os
> valores aprovados para impedir que a mesma divergência se repita.

Dois eixos **independentes** descrevem o ciclo de vida de uma `Company`:

- **`CompanyControlStatus`** — responde "quem detém a conta **hoje**?".
- **`CompanyOrigin`** — responde "como/por quem ela **nasceu**?", e nunca muda
  depois de criada.

Pré-cadastro (seção G do dossiê de auditoria) é uma **origem**
(`CompanyOrigin.SST_PROVIDER`), não um estado de controle — por isso
`CompanyControlStatus` não tem um valor "PRE_REGISTERED": uma empresa
pré-cadastrada por consultoria nasce `origin = SST_PROVIDER` +
`controlStatus = UNCLAIMED` (ninguém do lado da empresa assumiu a conta
ainda). Os dois campos evoluem separadamente — ex.: `CLAIM_PENDING` e
`DISPUTED` podem, em tese, ocorrer independente da origem.

```prisma
enum CompanyOperationalStatus {
  ACTIVE
  SUSPENDED
  CLOSED
}

enum CompanyControlStatus {
  UNCLAIMED     // ninguém do lado da empresa assumiu a conta ainda
  CLAIM_PENDING // reivindicação aberta, aguardando aprovação (FUTURO)
  CLAIMED       // controlada pelo representante da empresa (default de todo registro existente)
  DISPUTED      // mais de uma reivindicação concorrente em aberto (FUTURO)
}

enum CompanyOrigin {
  SELF_REGISTRATION // via /register, pela própria empresa (default de todo registro existente)
  SST_PROVIDER       // pré-cadastrada por uma consultoria SST (FUTURO)
  SUPER_ADMIN        // criada manualmente por um operador da plataforma (FUTURO)
  IMPORT             // criada por rotina de importação em lote (FUTURO)
}

enum CompanyDocumentType {
  CNPJ
  FOREIGN_REGISTRATION
}
```

Defaults para todo registro já existente: `operationalStatus = ACTIVE`,
`controlStatus = CLAIMED`, `origin = SELF_REGISTRATION`, `claimedAt = NULL`
(a data histórica real da reivindicação é desconhecida — não se infere/backfilla).

Ver `prisma/proposed/schema.company.m1.prisma` e
`prisma/proposed/M1_add_company_lifecycle_fields.sql` para o diff completo
(ainda não aplicado) e `prisma/proposed/README.md` para a política de deleção
de `createdByProviderId` (`RESTRICT`, com a busca que confirma a ausência de
hard delete de `SstProvider` no repositório).

---

## 2. Modelo atual vs. modelo-alvo de pertencimento

### 2.1 Hoje: `User.companyId` (single-tenant por usuário)

Cada `User` pertence a exatamente **uma** empresa (`User.companyId`, FK
obrigatória). Um usuário não consegue, hoje, pertencer a duas empresas do Portal
Empresa ao mesmo tempo.

### 2.2 (FUTURO) `CompanyMembership` (multi-tenant por usuário)

Para permitir que um mesmo usuário opere em mais de uma empresa (ex.: um
contador/gestor que atende várias filiais, ou o mesmo e-mail convidado por duas
empresas), o alvo é introduzir uma tabela de junção **`CompanyMembership`**
(`userId` × `companyId` × `status`), espelhando o padrão já usado com sucesso em
`SstProviderCompany` (o vínculo é uma entidade própria, com `status`, não um
campo no `User`).

Esta ADR **decide o alvo**, mas a `CompanyMembership` **não é criada** nesta
sprint (nem na Migration M1). `User.companyId` **permanece intacto** e
`requireCompany()` **não é alterado** — a migração para membership é um passo
posterior e aditivo.

---

## 3. Decisão sobre `UserRole` e sua relação com o contexto empresarial

`UserRole` (atribuição de um `Role` a um `User` dentro de uma empresa) já carrega
`companyId` explicitamente, além de `userId` e `roleId`.

**Decisão (Sprint 0.2):** quando `CompanyMembership` existir **(FUTURO)**,
**não** será criada uma FK entre `UserRole` e `CompanyMembership`.

- Motivo: `UserRole` já tem `companyId` e `Role` já tem `companyId`. Uma FK extra
  para `CompanyMembership` acopla duas preocupações (RBAC × pertencimento) e
  cria um ponto de falha de migração de dados (toda `UserRole` existente
  precisaria de uma membership correspondente materializada antes de ligar a
  constraint).
- **Invariante garantido no servidor (não por FK):** ao atribuir/usar uma
  `UserRole`, o servidor deve verificar que:
  1. `Role.companyId === UserRole.companyId` (o papel pertence à mesma empresa
     do vínculo); **e**
  2. existe uma `CompanyMembership` **`ACTIVE`** para `(userId, companyId)`
     **(FUTURO — enquanto for single-tenant, o equivalente é
     `User.companyId === UserRole.companyId`)**.

  Essa checagem é responsabilidade de código (um helper central de contexto —
  ver §5), não do banco. O banco continua garantindo apenas integridade
  referencial simples (`UserRole.roleId → Role`, `UserRole.companyId → Company`).

- Consequência: nenhuma migração destrutiva de RBAC é necessária para introduzir
  membership; a consistência `Role.companyId == contexto ativo` passa a ser
  reforçada no resolver de contexto.

---

## 4. Contexto ativo é uma preferência, não uma fonte de verdade

Quando um usuário puder pertencer a mais de uma empresa **(FUTURO)**, a UI
precisará lembrar "qual empresa está selecionada". Essa seleção poderá ser
persistida em **cookie** ou no objeto de **sessão**.

**Decisão:** o contexto empresarial armazenado em cookie ou sessão é tratado
como **preferência de UI não confiável** — exatamente como qualquer outro valor
originado no cliente.

- O cookie/sessão dizem, no máximo, *qual empresa o usuário gostaria de usar*.
- Eles **nunca** autorizam acesso por si só.
- Antes de servir qualquer dado, o servidor **resolve o contexto novamente**:
  toma o `companyId` pretendido (do cookie/sessão/param) e o **valida** contra
  uma `CompanyMembership` `ACTIVE` daquele `userId` **(FUTURO)**. Se não houver
  membership ativa correspondente, o pedido é negado (403/`forbidden()`), sem
  vazar dado — nunca se "confia" no valor só porque veio de um cookie assinado.
- Um cookie de contexto adulterado/obsoleto (ex.: apontando para uma empresa da
  qual o usuário foi removido) resulta em negação, não em acesso.

Isto é a mesma disciplina que já existe hoje no Portal Consultoria:
`requireSstProviderCompanyAccess(companyId)` recebe o `companyId` da URL e o
revalida contra `SstProviderCompany.status = ACTIVE` antes de qualquer leitura.

---

## 5. Resolver central de contexto, independente das APIs do Next.js (FUTURO)

**Decisão:** a resolução do contexto empresarial (dado um `userId` + um
`companyId` pretendido → devolve o contexto validado, ou nega) deve viver em um
**resolver central puro**, que **não** dependa de APIs de Route Handler do
Next.js (`headers()`, `cookies()`, `next/navigation`).

Motivos:

1. **Reuso pelos hooks do Better Auth.** Os hooks `before`/`after`
   (`lib/auth.ts`) rodam dentro do pipeline do Better Auth, **fora** de uma Route
   Handler — ali **não** é seguro chamar `headers()`/`cookies()` de
   `next/headers` (são APIs de request scope do Next). O hook recebe seu próprio
   `ctx.headers`. Para o hook conseguir resolver/registrar o contexto correto
   (ex.: escolher o `companyId` ativo ao logar, ou auditar no tenant certo), ele
   precisa de uma função de resolução que aceite os dados crus como argumento —
   não uma que leia o request context do Next por baixo dos panos.
2. **Reuso por `requireCompany()`.** O helper de Portal Empresa passa a delegar a
   validação de contexto ao mesmo resolver, garantindo uma única
   implementação da regra "esse usuário pode operar nessa empresa?".
3. **Testabilidade.** Um resolver puro (entrada → saída, sem tocar
   `next/headers`) é testável sem simular um request do Next — reduz o atrito da
   rede de testes de isolamento de tenant (ver Sprint 0.2, Parte C).

Forma pretendida (assinatura ilustrativa, **não implementada nesta sprint**):

```ts
// lib/company-context.ts (FUTURO)
// Puro: recebe ids, consulta o banco, devolve contexto validado ou lança/nega.
// NÃO importa next/headers, next/navigation nem nada de Route Handler.
async function resolveCompanyContext(input: {
  userId: string;
  requestedCompanyId?: string; // preferência (cookie/sessão/param) — não confiável
}): Promise<{ companyId: string /* validado */ }>;
```

- `requireCompany()` (Route Handler / Server Component) leria a preferência via
  `next/headers` e **passaria** o valor cru para `resolveCompanyContext`.
- Os hooks do Better Auth passariam os valores que já têm em `ctx`, **sem**
  chamar `next/headers`.

**Nesta sprint:** apenas registramos a decisão. `requireCompany()` **não é
alterado** e o resolver **não é criado**.

---

## 6. Rota futura: convidar um usuário existente para uma segunda empresa (FUTURO)

Hoje só há duas formas de um `User` ganhar uma empresa: `POST /api/register`
(cria empresa nova + primeiro admin) e o convite interno de
`configuracoes/usuarios` (cria um `User` novo dentro da empresa atual). **Não
existe** um caminho para vincular um **usuário já existente** (por e-mail) a uma
**segunda** empresa.

**Decisão de alvo:** haverá uma rota administrativa, ex.:

```
POST /api/company/members        # convidar/vincular um usuário existente à empresa atual
```

Regras de alvo:

- Executada por um usuário com permissão `user:manage` **na empresa que convida**
  (o `companyId` de destino vem sempre do contexto do servidor, nunca do body).
- Se o e-mail já corresponde a um `User`, cria uma **`CompanyMembership`** nova
  (status inicial a definir — provavelmente `PENDING`/`ACTIVE` conforme política
  de aceite), **sem** duplicar a identidade e **sem** mexer em `User.companyId`.
- Papéis nessa segunda empresa são `UserRole` novas com o `companyId` da empresa
  que convidou — respeitando o invariante da §3 (`Role.companyId` == empresa do
  vínculo, membership `ACTIVE`).
- Nunca transforma o usuário em membro de uma empresa sem uma membership
  explícita e validável; o "contexto ativo" continua sendo só preferência (§4).

**Não implementada nesta sprint.**

---

## 7. Invariantes que valem HOJE (não mudam nesta sprint)

- Tenant nunca vem do cliente; sempre da sessão/servidor.
- `SstProvider` é global (sem `companyId`); o isolamento vem inteiramente de
  `SstProviderCompany`.
- O Portal Consultoria nunca lê `User.companyId`.
- `requireCompany()` e `User.companyId` permanecem **inalterados**.

---

## 8. Consequências

- **Positivas:** caminho claro (e aditivo) para multi-tenant por usuário sem
  reescrever RBAC; regra única de "pode operar nessa empresa?" em um resolver
  central; hooks do Better Auth e Route Handlers compartilham a mesma validação;
  cookie de contexto deixa de ser superfície de ataque (é só preferência).
- **Custos/риscos:** a consistência `Role.companyId == contexto ativo` passa a
  depender de disciplina de código (não de FK) — mitigado por testes de
  isolamento de tenant (Sprint 0.2, Parte C) e pela centralização no resolver.
- **Fica para depois:** criar `CompanyMembership`, o resolver central, a rota de
  convite de usuário existente e a adaptação de `requireCompany()` — cada um em
  sua própria sprint, todos aditivos.
