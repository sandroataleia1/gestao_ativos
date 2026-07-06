# Documentos e assinatura digital de custódia

Evidência formal do ciclo Estoque → Entrega → Custódia → Devolução: um termo
em HTML gerado a partir dos dados da própria `AssetCustody`, e uma ou mais
assinaturas vinculadas a esse termo.

## 1. Modelo de domínio

### Por que dois models (`CustodyDocument` e `CustodySignature`), e não campos em `AssetCustody`

Um termo pode ser gerado mais de uma vez para a mesma custódia (termo de
entrega e, depois, termo de devolução), e um mesmo termo pode ser assinado
por mais de uma pessoa (colaborador e responsável pelo almoxarifado, por
exemplo) — uma relação 1:N em cada nível, incompatível com colunas em
`AssetCustody`. Por isso:

- `CustodyDocument` — 1 linha por termo gerado (`type` diferencia entrega de
  devolução).
- `CustodySignature` — 1 linha por assinatura, referenciando o documento
  assinado (`documentId`) e, de forma denormalizada, a própria custódia
  (`custodyId`) para permitir consultar todas as assinaturas de uma
  custódia sem passar pela tabela de documentos.

```prisma
enum CustodyDocumentType {
  DELIVERY_TERM
  RETURN_TERM
}

model CustodyDocument {
  id          String              @id @default(cuid())
  companyId   String
  custodyId   String
  type        CustodyDocumentType
  contentHtml String
  pdfUrl      String?
  generatedAt DateTime
  createdAt   DateTime            @default(now())
}

model CustodySignature {
  id                String   @id @default(cuid())
  companyId         String
  custodyId         String
  documentId        String
  signerName        String
  signerDocument    String
  signatureImageUrl String?
  signatureData     String?
  signedAt          DateTime
  ipAddress         String?
  userAgent         String?
  createdAt         DateTime @default(now())
}
```

### Por que `type` é `enum`, não tabela parametrizável

Segue o mesmo raciocínio de `CertificationType`/`CertificationStatus` (ver
`docs/certifications.md`): "termo de entrega" e "termo de devolução" são
conceitos definidos pela própria plataforma (o texto e o momento em que cada
um pode ser gerado são regra de código, não customização de empresa), então
não seguem o padrão `AssetStatus`/`AssetCondition`/`MovementType` (tabelas
por empresa, usadas para estados de workflow que cada empresa define).

### `signatureImageUrl` vs. `signatureData`

Os dois campos são opcionais no schema, mas a aplicação exige pelo menos um
dos dois (`lib/validations/custody-document.ts`, via `.refine`):

- `signatureData` é o caminho usado hoje: uma data URL base64
  (`data:image/png;base64,...`) exportada do `<canvas>` de assinatura da UI.
- `signatureImageUrl` fica preparado para um cenário futuro de upload de uma
  imagem de assinatura já pronta (ex.: assinatura eletrônica capturada em
  outro sistema) — não implementado agora.

### `pdfUrl`

Preparado para uma etapa futura de geração de PDF a partir do
`contentHtml` (ex.: via um serviço de renderização). Hoje o termo só existe
como HTML e `pdfUrl` fica sempre `null` — nenhuma rota gera ou aceita esse
campo ainda.

### `ipAddress`/`userAgent`

Nunca vêm do corpo da requisição enviado pelo client — são lidos direto dos
headers da própria requisição HTTP em `POST /api/custodies/[id]/signatures`
(`x-forwarded-for`/`user-agent`), para que essa evidência não possa ser
forjada por quem está assinando.

## 2. Geração do termo (HTML)

`buildCustodyTermHtml` (`lib/custodies/index.ts`) monta o HTML a partir dos
dados já carregados da custódia (mesmo `custodyListInclude` usado pelas
demais rotas de `/api/custodies`) e da empresa (`name`/`document`):

- Dados da empresa, colaborador (nome + documento), ativo (nome + código),
  quantidade ou unidade (número de série/patrimônio), local, data do evento
  (entrega ou devolução, conforme `type`), motivo/observações quando
  preenchidos, e um bloco fixo de responsabilidades do colaborador (zelar
  pela guarda, comunicar danos/perda, devolver quando solicitado, etc.).
- Todo texto vindo do banco passa por `escapeHtml` antes de entrar no HTML —
  o `contentHtml` é renderizado com `dangerouslySetInnerHTML` na tela de
  visualização, então sem isso uma observação gravada anteriormente com
  `<script>` viraria XSS armazenado.
- `RETURN_TERM` só pode ser gerado se `AssetCustody.status === "RETURNED"`
  (validado na rota, não só na UI) — não faz sentido emitir um termo de
  devolução de algo que ainda está em posse do colaborador.

## 3. APIs

- `POST /api/custodies/[id]/documents` — gera um novo `CustodyDocument`
  (`{ type: "DELIVERY_TERM" | "RETURN_TERM" }`). Exige `custody:manage`.
- `GET /api/custodies/[id]/documents` — lista os documentos da custódia,
  com as assinaturas já incluídas. Exige `custody:view`.
- `POST /api/custodies/[id]/signatures` — registra uma assinatura vinculada
  a um `documentId` (que precisa pertencer à mesma custódia e empresa).
  Exige `custody:manage`.

Todas as três derivam `companyId` da sessão (nunca do client) e validam que
a custódia/documento pertence à empresa atual antes de qualquer leitura ou
escrita — mesmo padrão de todo o restante do módulo de custódia.

## 4. UI

Em `/custodies`, cada linha da tabela (em qualquer uma das três abas) ganhou
um botão "Documentos", que abre `CustodyDocumentsDialog`
(`app/(app)/custodies/custody-documents-dialog.tsx`):

- Lista os termos já gerados para aquela custódia, com suas assinaturas.
- Botões "Gerar termo de entrega" / "Gerar termo de devolução" (este último
  só aparece quando a custódia já foi devolvida) — visíveis apenas para
  quem tem `custody:manage`.
- "Visualizar" abre o `contentHtml` do termo em um modal somente leitura.
- "Assinar" abre um modal com campos de nome/documento do assinante e um
  `<canvas>` de assinatura (captura por eventos `pointerdown`/`pointermove`,
  convertido para `signatureData` via `canvas.toDataURL("image/png")` no
  momento de salvar).

## 5. Fora de escopo (por ora)

- Geração de PDF (`pdfUrl` fica preparado, mas nunca preenchido).
- Envio do termo por e-mail ou qualquer notificação ao colaborador.
- Assinatura eletrônica com certificado digital (ICP-Brasil ou similar) —
  `signatureData` hoje é só o traço capturado no canvas, sem validade
  jurídica de assinatura qualificada.
