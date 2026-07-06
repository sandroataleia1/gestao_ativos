# Certificações de ativos (CA, INMETRO, ANATEL, ISO, ...)

Este documento cobre o suporte a Certificado de Aprovação (CA) de EPIs e,
mais amplamente, a qualquer certificação/homologação aplicável a um `Asset`.

## 1. Modelo de domínio

### Por que um model dedicado, e não campos em `Asset`

Nem todo ativo tem certificação (notebooks, ferramentas genéricas), e os que
têm podem ter mais de uma ao longo do tempo (CA vencido substituído por um
novo, por exemplo) ou de tipos diferentes (CA + ISO). Colocar isso em colunas
do `Asset` significaria:

- Colunas quase sempre nulas para a maioria dos ativos.
- Impossível representar histórico (CA antigo + CA vigente).
- Cada novo tipo de certificação (INMETRO, ANATEL, ISO...) exigiria mais
  colunas em `Asset`, incluindo `Asset` em cada vez mais migrations não
  relacionadas ao seu papel de cadastro mestre.

Por isso, `AssetCertification` é uma tabela própria, com relação 1:N a
`Asset` (`Asset.certifications AssetCertification[]`). `Asset` ganhou **só**
essa relação reversa — nenhuma coluna nova.

### Por que `AssetCertification`, e não `AssetCA`

`certificationType` é extensível (`CA`, `INMETRO`, `ANATEL`, `ISO`,
`OUTROS`), então nomear a tabela com o acrônimo de um tipo específico
("AssetCA") ficaria incorreto assim que o primeiro registro não-CA for
cadastrado. `AssetCertification` segue o mesmo padrão `Asset<Substantivo
genérico>` já usado em `AssetCategory`, `AssetStatus`, `AssetMovement`,
`AssetCustody` etc.

### Por que `certificationType`/`status` são `enum`, não tabela parametrizável

O restante do domínio tem um padrão explícito: `AssetStatus`,
`AssetCondition`, `LocationType` e `MovementType` **não são enum** — são
tabelas por empresa, porque representam **estados de workflow que cada
empresa define para si** (ex.: uma empresa pode ter o status "Em
calibração", outra não).

Certificação é diferente: `CA`, `INMETRO`, `ANATEL`, `ISO` são classificações
**regulatórias externas**. Nenhuma empresa "cria" um novo tipo de
certificação — quem evolui essa lista é a própria plataforma, via migration,
à medida que passa a suportar novos tipos (o mesmo raciocínio já usado para
`TrackingMode`, que também é `enum`). Da mesma forma, "válido / vencido /
suspenso / cancelado / pendente" é o ciclo de vida universal de qualquer
certificado, não uma customização de empresa.

```prisma
enum CertificationType {
  CA
  INMETRO
  ANATEL
  ISO
  OUTROS
}

enum CertificationStatus {
  VALID
  EXPIRED
  SUSPENDED
  CANCELLED
  PENDING
}
```

Evoluir a lista (ex.: adicionar `CE` no futuro) é uma migration simples de
`ALTER TYPE ... ADD VALUE`, sem tocar em dados existentes.

### Campos estruturados vs. `metadata` (JSON)

```prisma
model AssetCertification {
  id                  String              @id @default(cuid())
  companyId           String
  company             Company             @relation(fields: [companyId], references: [id])
  assetId             String
  asset               Asset               @relation(fields: [assetId], references: [id])
  certificationType   CertificationType
  certificationNumber String
  issueDate           DateTime?
  expirationDate      DateTime?
  status              CertificationStatus @default(VALID)
  issuer              String?
  documentUrl         String?
  externalId          String?
  lastSyncAt          DateTime?
  metadata            Json?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  @@unique([companyId, certificationType, certificationNumber])
  @@index([companyId])
  @@index([assetId])
  @@index([expirationDate])
}
```

Os campos acima são **comuns a qualquer tipo de certificação** e por isso
são colunas de primeira classe (permitem filtro/índice — ex.: "CA vencido"
precisa comparar `expirationDate` diretamente, o que exige coluna real, não
uma chave dentro de JSON).

Campos que só fazem sentido para **um tipo específico** — no caso do CA:
fabricante homologado, descrição oficial, tipo de proteção e norma aplicável
— ficam dentro de `metadata` (JSON), não como colunas. Isso evita que a
tabela cresça uma coluna a cada novo tipo de certificação suportado; cada
tipo define seu próprio "formato" de metadata na camada de aplicação
(`lib/validations/certification.ts`):

```ts
// Formato de metadata específico do tipo CA.
export const caMetadataSchema = z.object({
  approvedManufacturer: z.string().optional(), // fabricante homologado
  officialDescription: z.string().optional(),  // descrição oficial
  protectionType: z.string().optional(),       // tipo de proteção
  applicableStandard: z.string().optional(),   // norma aplicável
});
```

Um futuro tipo `INMETRO` teria seu próprio `inmetroMetadataSchema`, sem
precisar de migration.

### `externalId` / `lastSyncAt`

Pensados para integração futura (seção 3): `externalId` guarda o
identificador do registro no sistema de origem (ex.: o número do processo na
API pública de consulta de CA), e `lastSyncAt` marca a última vez que os
dados foram confirmados por um `CertificationProvider` externo. Ambos ficam
`null` para registros cadastrados manualmente e nunca sincronizados.

### Um ativo pode ter várias certificações

A relação é 1:N, não 1:1. Motivos: histórico (CA vencido + CA renovado) e
múltiplos tipos (CA de um EPI + eventual certificação ISO do mesmo item). O
badge "possui CA válido" (seção 2) olha para **todas** as certificações do
tipo `CA` do ativo, não para uma única.

## 2. Cálculo do badge de CA

`lib/certifications/index.ts` centraliza a lógica — nem a UI nem a API
duplicam essa regra:

```ts
export function computeCaBadge(certifications): "VALID" | "EXPIRED" | "NONE" {
  const caCertifications = certifications.filter((c) => c.certificationType === "CA");
  if (caCertifications.length === 0) return "NONE";

  const hasValid = caCertifications.some(
    (c) => c.status === "VALID" && (!c.expirationDate || c.expirationDate >= new Date()),
  );
  return hasValid ? "VALID" : "EXPIRED";
}
```

- **Sem CA**: nenhuma `AssetCertification` do tipo `CA` associada.
- **CA válido**: existe ao menos uma com `status = VALID` e sem
  `expirationDate` ou com `expirationDate` no futuro.
- **CA vencido**: existe alguma certificação `CA`, mas nenhuma satisfaz a
  condição acima (todas expiradas, suspensas, canceladas etc.).

O mesmo critério vira filtro server-side em `GET /api/assets?caStatus=`
(`valid` | `expired` | `none`), via `buildCaStatusWhere` — usado como cláusula
Prisma `where` (`certifications: { some/none: {...} }`).

## 3. Arquitetura para integrações externas

`lib/certifications/provider.ts` define o contrato que qualquer fonte de
consulta de certificação deve seguir:

```ts
export interface CertificationProvider {
  getByNumber(type: CertificationType, number: string): Promise<CertificationData | null>;
}
```

`CertificationData` é o formato normalizado de retorno — independente da
fonte, sempre os mesmos campos estruturados + `metadata` livre.

Hoje existe apenas `ManualCertificationProvider`
(`lib/certifications/manual-provider.ts`), que **não consulta nada** —
`getByNumber` sempre retorna `null`, porque os dados só entram via
formulário manual (`POST`/`PUT /api/assets`, campo `certification`). Esta
classe existe para:

1. Deixar o contrato (`CertificationProvider`) já em uso por algo real,
   validando que a interface faz sentido antes de existir uma integração de
   verdade.
2. Servir de "no-op" seguro caso o restante do código já espere injetar um
   provider (ex.: um botão futuro "Consultar CA automaticamente").

### Como uma integração real será adicionada (futuro, **não implementado**)

1. Criar `lib/certifications/<nome>-provider.ts` implementando
   `CertificationProvider`, chamando a API externa de fato e mapeando a
   resposta para `CertificationData` (campos específicos do tipo vão em
   `metadata`, seguindo o `*MetadataSchema` do tipo correspondente).
2. Ao consultar com sucesso, o código que chama o provider grava/atualiza o
   `AssetCertification` com `externalId` e `lastSyncAt = new Date()`,
   reaproveitando `upsertAssetCertification` (`lib/certifications/index.ts`).
3. Trocar qual provider é usado é só trocar a instância injetada — nenhuma
   rota, componente de UI ou schema muda, porque tudo já conversa com a
   interface `CertificationProvider`, não com uma implementação concreta.
4. Não há fila, cron ou webhook de sincronização automática ainda — isso é
   trabalho de uma etapa futura, fora do escopo desta entrega.

## 4. APIs

- `GET /api/assets` e `GET /api/assets/[id]`: a resposta de cada ativo já
  inclui `certifications: AssetCertification[]` (via `assetListInclude` em
  `lib/assets.ts`). `GET /api/assets` aceita `?caStatus=valid|expired|none`.
- `POST /api/assets` e `PUT /api/assets/[id]`: aceitam um campo opcional
  `certification` no corpo. Presença de `certification.id` decide
  criar vs. atualizar (`upsertAssetCertification`); omitir o campo não altera
  as certificações existentes do ativo. A criação/atualização roda na mesma
  transação Prisma do próprio Asset.
- Número de certificação duplicado (`companyId + certificationType +
  certificationNumber`) é bloqueado por `@@unique` no banco, convertido em
  409 amigável por `lib/api-errors.ts`.

## 5. UI

No formulário de ativo (`app/(app)/assets/asset-form-dialog.tsx`), uma seção
"Certificado de Aprovação (CA)" com um seletor "possui CA / não possui" que
revela os campos (número, situação, emissão, validade, órgão emissor,
fabricante homologado, tipo de proteção, norma aplicável, descrição
oficial) só quando marcado. Hoje a UI edita apenas a certificação do tipo
`CA` mais recente do ativo — o modelo já suporta múltiplas/outros tipos,
mas uma tela dedicada de gestão de certificações (todas, todos os tipos) é
trabalho futuro.

Na tabela (`app/(app)/assets/assets-table.tsx`): coluna "CA" com o badge
(Válido/Vencido/Sem CA) e um filtro dedicado com as mesmas três opções,
usando `computeCaBadge` no client sobre os dados já carregados.
