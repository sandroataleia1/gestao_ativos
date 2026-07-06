# QR Code para rastreabilidade

Identificação rápida de um `Asset`, `AssetUnit` ou `AssetCustody` por QR Code,
sem expor o `id` (cuid) interno de nenhum dos três.

## 1. Identificador público

Cada um dos três models ganhou uma coluna `qrCodeToken String? @unique`:

```prisma
model Asset {
  // ...
  qrCodeToken String? @unique
}

model AssetUnit {
  // ...
  qrCodeToken String? @unique
}

model AssetCustody {
  // ...
  qrCodeToken String? @unique
}
```

- Nulo até alguém clicar em "Gerar QR Code" pela primeira vez — não é
  preenchido automaticamente na criação do registro.
- Gerado com `crypto.randomBytes(24).toString("base64url")`
  (`lib/qr-code.ts`): 32 caracteres, imprevisível, sem relação com o `id`
  interno.
- "Gerar QR Code" é **idempotente**: se o recurso já tem um token, a API
  devolve o mesmo (nunca gera um novo). Isso é deliberado — numa etiqueta
  física já impressa e colada no ativo, trocar o token invalidaria a
  etiqueta a cada novo clique no botão.

### `AssetUnit.qrCode` vs. `AssetUnit.qrCodeToken`

`AssetUnit` já tinha um campo `qrCode String?` do modelo de domínio original
— um campo de texto livre, preenchido manualmente, sem relação com nenhuma
rota da aplicação. `qrCodeToken` é um campo novo e distinto: o identificador
opaco gerado e controlado pela própria aplicação, usado especificamente por
`/q/[token]` e `GET /api/qr/[token]`. Os dois convivem no schema; não
reaproveitamos `qrCode` para não misturar um valor de entrada manual do
usuário com um token de segurança gerado pelo sistema.

## 2. APIs

### `POST /api/assets/[id]/qr`, `POST /api/asset-units/[id]/qr`, `POST /api/custodies/[id]/qr`

Cada uma exige a permissão de **gestão** do recurso correspondente
(`asset:manage`, `asset_unit:manage`, `custody:manage`) — gerar um QR Code é
uma ação de escrita (grava o token pela primeira vez) e seguem o mesmo
padrão de toda escrita no app: `companyId` sempre derivado da sessão via
`requirePermission`, nunca aceito do client. Resposta: `{ token, url }`,
onde `url` é o caminho relativo `/q/[token]`.

### `GET /api/qr/[token]`

Rota **pública** (sem `requirePermission`/`requireAuth`) — é o que a página
`/q/[token]` (e qualquer outro client) usa para resolver um token escaneado.
Verifica o token nas três tabelas, na ordem Asset → AssetUnit →
AssetCustody (o primeiro `findUnique` que bater vence; colisão de token
entre tabelas é praticamente impossível dado o espaço aleatório usado).

Resposta:

```json
{
  "type": "ASSET" | "ASSET_UNIT" | "CUSTODY",
  "company": { "name": "..." },
  "status": "...",
  "data": { /* campos específicos do tipo, ver lib/qr-code.ts */ },
  "permissions": { "authenticated": bool, "sameCompany": bool, "canView": bool, "canManage": bool }
}
```

`permissions` reflete a sessão de quem está chamando **agora**, calculada em
`computeQrPermissions`:

- Sem sessão, ou sessão de uma empresa diferente da dona do recurso: tudo
  `false` — nunca vaza dado de outra empresa por engano, mesmo que a rota
  seja pública.
- Sessão da mesma empresa: `canView`/`canManage` viram os `hasPermission`
  reais (`asset:view`/`manage`, `asset_unit:view`/`manage`,
  `custody:view`/`manage`) daquele usuário.

Os campos em `data` já são o subconjunto seguro para qualquer visitante
(nome, código, status, categoria/condição, local atual só quando
`canView`) — não incluem CPF/documento do colaborador nem o HTML do termo de
custódia; esses ficam atrás de `custody:view` de verdade, via as rotas já
existentes de `/api/custodies/[id]/documents` (ver `docs/custody-documents.md`).

## 3. Nunca escrever via QR Code (requisito 6)

`GET /api/qr/[token]` e a página `/q/[token]` são **somente leitura** — não
existe nenhuma rota `PUT`/`PATCH`/`DELETE` associada a um token. A única
ação disponível para quem tem `canManage` é um link "Gerenciar no sistema",
que leva para a tela autenticada de verdade (`/assets`, `/stock` ou
`/custodies`) — qualquer escrita a partir daí passa pelos mesmos
`requirePermission` de sempre, não pelo token.

## 4. UI

- **Ativos** (`app/(app)/assets/assets-table.tsx`): item "Gerar QR Code" no
  menu de ações de cada linha, ao lado de "Editar"/"Excluir".
- **Custódia** (`app/(app)/custodies/custody-table.tsx`): botão "QR Code" em
  cada linha (qualquer aba), visível para quem tem `custody:manage`. Abre um
  diálogo com até três seções — Ativo, Unidade (patrimônio, só quando a
  custódia é de um `AssetUnit`) e Custódia (a entrega em si) — cobrindo os
  três tipos de QR do requisito 2 num único lugar coerente, já que a tela de
  custódia é onde as três entidades aparecem juntas. Não existe uma tela de
  listagem dedicada de `AssetUnit` hoje, por isso o QR de unidade é gerado a
  partir do contexto de custódia em vez de uma tela própria.
- Ambos reaproveitam `components/qr/qr-code-section.tsx` (gera + mostra o QR
  via `qrcode.react`, com botão "Copiar link") e
  `components/qr/qr-code-dialog.tsx` (agrupa 1+ seções num diálogo).
- **`/q/[token]`** (`app/q/[token]/page.tsx`): página pública/controlada
  (requisito 5), fora do grupo de rotas autenticado `(app)` — sem sidebar,
  não exige login. Mostra tipo do recurso, status, empresa, e os campos
  básicos do tipo; para custódia, mostra também a lista de termos gerados
  com o badge "Assinado"/"Pendente de assinatura" (requisito 7) e, quando
  `canView` é true, um botão "Ver termo" que abre o HTML completo
  (reaproveita `GET /api/custodies/[id]/documents`, já autenticado/gated).

## 5. Fora de escopo (por ora)

- Impressão/exportação da imagem do QR Code (a seção de QR só mostra o SVG
  na tela e o link para copiar; gerar um PDF de etiqueta é trabalho futuro).
- Revogar/regenerar um token já emitido (o botão é estritamente
  get-or-create, nunca substitui um token existente).
- Uma tela de listagem dedicada de `AssetUnit` (o QR de unidade hoje só é
  alcançável a partir de uma custódia existente daquela unidade).
