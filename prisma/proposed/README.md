# Propostas de migration (NÃO aplicadas)

Esta pasta contém migrations **propostas para revisão** — o Prisma **não** lê
nada aqui. Nenhuma delas foi aplicada ao banco. Aplicar só depois de aprovação
explícita, copiando o SQL para uma migration real em `prisma/migrations/`.

## M1 — `M1_add_company_lifecycle_fields.sql` (Revisão 2)

Adiciona ciclo de vida e proveniência à `Company`. **Exclusivamente aditiva.**
Revisada após aprovação parcial da Sprint 0.2 para alinhar os enums e a
política de deleção ao ADR-001 aprovado.

- `schema.company.m1.prisma` — o diff proposto para `prisma/schema.prisma`.
- `M1_add_company_lifecycle_fields.sql` — o SQL exato
  (`prisma migrate diff`, conferido contra o banco de dev: sem drift).

### Por que `CompanyControlStatus` não tem `PRE_REGISTERED`

`controlStatus` responde "quem detém a conta hoje?"; `origin` responde "como/por
quem ela nasceu?". Pré-cadastro é uma **origem** (`CompanyOrigin.SST_PROVIDER`),
não um estado de controle — uma empresa pré-cadastrada por uma consultoria
nasce com `controlStatus = UNCLAIMED` (ninguém do lado da empresa assumiu a
conta ainda) e `origin = SST_PROVIDER` (foi a consultoria quem a criou). Os dois
eixos são independentes: uma empresa pode ser `SELF_REGISTRATION` e ainda assim,
em teoria, passar por `CLAIM_PENDING`/`DISPUTED` (ex.: fluxo de recuperação de
conta) — misturar os dois num enum só impediria essa combinação.

### Política de deleção de `createdByProviderId` — `ON DELETE RESTRICT`

`createdByProviderId` é uma FK **opcional** de `Company` para `SstProvider`,
registrando qual consultoria pré-cadastrou a empresa (uso FUTURO).

**Busca no repositório por hard delete de `SstProvider`:**

```
grep -rn "sstProvider.delete\|sstProvider.deleteMany" app/ lib/
```

Resultado: **nenhuma ocorrência** em `app/**` ou `lib/**`. A única chamada de
`prisma.sstProvider.deleteMany(...)` em todo o repositório está em
`tests/helpers/db.ts` (limpeza de fixtures de teste — infraestrutura de teste,
não um fluxo de produto). Não existe rota (`app/api/sst-providers/**`) nem
função em `lib/sst-providers.ts` que apague fisicamente um `SstProvider`; a
única forma de "desligar" um prestador hoje é o campo `SstProvider.active`
(soft, ex.: `active: false`), e o encerramento de um vínculo específico é
`SstProviderCompany.status → REVOKED` (também soft). **Confirmado: não há
fluxo funcional necessário de hard delete de `SstProvider`.**

Com isso, a política de deleção escolhida foi:

| Política         | O que acontece se o prestador for removido        | Adequada? |
|------------------|-----------------------------------------------------|-----------|
| `CASCADE`        | A empresa seria **apagada** junto. Inaceitável.     | ❌ |
| **`RESTRICT`**   | Um hard delete de `SstProvider` referenciado por `createdByProviderId` falha explicitamente no banco, obrigando quem for remover o prestador a primeiro desativá-lo (`active: false`) — sem apagar a proveniência nem arriscar apagar a empresa em cascata. Como não existe fluxo de hard delete hoje, a constraint nunca bloqueia uma operação real; ela só existe para impedir que uma futura rota administrativa apague um prestador "por baixo" e corrompa a proveniência histórica. | ✅ (escolhida) |
| `SET NULL`       | Preservaria a empresa, mas apagaria silenciosamente a proveniência histórica ("quem criou esta empresa?") — informação que a auditoria/compliance do canal comercial de pré-cadastro (seção G do dossiê de auditoria) precisa manter íntegra. | ❌ (descartada nesta revisão) |

Motivos para `RESTRICT` (em vez do `SET NULL` da proposta anterior):

1. **`createdByProviderId` é proveniência histórica**, não um vínculo
   operacional (esse já existe, e já é soft, via `SstProviderCompany`). Perder
   essa informação silenciosamente (como `SET NULL` faria) enfraquece a trilha
   de auditoria do canal comercial descrito no dossiê (seção G/I).
2. **O ciclo de vida correto de um `SstProvider` é soft** (`active: false`),
   nunca hard delete — confirmado pela busca acima. `RESTRICT` apenas torna
   essa expectativa explícita no banco: se algum dia alguém tentar um hard
   delete, o erro de FK é o sinal correto de "isso deveria ser uma
   desativação lógica, não uma remoção física".
3. Como nenhuma rota tenta esse hard delete, `RESTRICT` não é uma
   trava prática hoje — é uma salvaguarda para o futuro.

## M2A — `M2A_add_company_memberships.sql`

Cria a tabela `CompanyMembership` (o vínculo usuário↔empresa, base para
multi-tenant por usuário — ver docs/adr/ADR-001, seções 2.2 e 3).
**Exclusivamente aditiva; nasce vazia.** O backfill (M2B,
`scripts/backfill-company-memberships.ts`) é um passo **separado e
versionado**, nunca parte da migration.

- `schema.company-membership.m2a.prisma` — o diff proposto para
  `prisma/schema.prisma`.
- `M2A_add_company_memberships.sql` — o SQL exato (`prisma migrate diff`,
  conferido contra o banco de dev pós-M1: sem drift).

### Sem FK entre `UserRole` e `CompanyMembership`

Decisão já registrada no ADR-001, seção 3: o invariante "`Role.companyId`
igual ao `companyId` da membership, e a membership `ACTIVE`" é garantido em
código (um futuro resolver central de contexto), não por constraint de banco.
Isso evita acoplar o RBAC existente (que já funciona e tem `companyId`
redundante em `UserRole`) ao novo conceito de membership antes de haver um
ponto único de validação.

### Políticas de deleção das 3 FKs

| FK | Política | Motivo |
|---|---|---|
| `userId → User` | `CASCADE` | Uma membership não existe sem o usuário titular — excluir o `User` remove suas memberships junto (mesmo padrão de `Session`/`Account`, que já usam `onDelete: Cascade` a partir de `User`). |
| `companyId → Company` | `RESTRICT` | Mesma lógica da FK `createdByProviderId` da M1: nunca permitir apagar fisicamente uma empresa que ainda tem membership vinculada — força um encerramento explícito antes. Hoje não existe nenhuma rota de exclusão física de `Company` (confirmado na auditoria original), então esta constraint não bloqueia nenhum fluxo real; é salvaguarda para o futuro. |
| `invitedByUserId → User` | `SET NULL` | `invitedByUserId` é proveniência acessória ("quem convidou"), não o vínculo em si — excluir o usuário convidador preserva a membership do convidado, só perde o registro de quem convidou. Mesmo padrão já usado em `AuditLog.actorUserId` e `SstProviderCompany.approvedByUserId`. |

### Nota de formatação (não semântica)

A sintaxe `@relation(...)` multi-linha do texto original da sprint não é
aceita pelo parser do Prisma 7 (cada linha precisa ser uma declaração de
campo/atributo completa — ver erro `P1012` ao tentar validar a versão
multi-linha). Foi colapsada para uma linha por campo, preservando
exatamente os mesmos argumentos (nome da relação, `fields`, `references`,
`onDelete`, `onUpdate`). O SQL gerado é idêntico ao que a versão multi-linha
geraria — é puramente uma diferença de formatação de texto, não de schema.
