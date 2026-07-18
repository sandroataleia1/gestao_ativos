# Certificado e lista de presença assinada (turmas de treinamento)

Sprint SST 1.4H, fatia 2. Espelha `docs/custody-documents.md` — mesma
decisão de modelagem (documento + assinatura como models próprios, não
campos em `TrainingParticipant`/`TrainingClass`), adaptada ao domínio de
treinamento. Só Portal Empresa nesta fatia; sem PDF; sem assinatura remota.

## 1. Modelo de dados

### Por que dois models, e por que diferentes de `CustodyDocument`/`CustodySignature`

```prisma
enum TrainingClassDocumentType {
  ATTENDANCE_LIST
  CERTIFICATE
}

model TrainingClassDocument {
  id              String   @id @default(cuid())
  companyId       String
  trainingClassId String
  type            TrainingClassDocumentType
  participantId   String?
  contentHtml     String
  pdfUrl          String?
  generatedAt     DateTime
  createdAt       DateTime @default(now())
  signatures      TrainingClassSignature[]
}

model TrainingClassSignature {
  id                String   @id @default(cuid())
  companyId         String
  documentId        String
  participantId     String
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

- **Lista de presença** (`type: ATTENDANCE_LIST`) é 1 documento por turma
  (`participantId: null`), cobrindo todos os participantes `ENROLLED` no
  momento da geração — pode ser gerada mais de uma vez (histórico
  preservado, nunca sobrescreve a anterior), várias assinaturas (uma por
  participante).
- **Certificado** (`type: CERTIFICATE`) é 1 documento por participante
  (`participantId` obrigatório), gerado só quando `resultStatus: APPROVED`
  — nunca tem assinatura (é emitido, não atestado pelo próprio
  colaborador). Pode ser gerado mais de uma vez (2ª via), mesmo padrão de
  não sobrescrever.
- CHECK manual (migração `20260718101717_training_class_documents`):
  `participantId` sempre preenchido para `CERTIFICATE`, sempre `null` para
  `ATTENDANCE_LIST`.
- **Diferença chave em relação a `CustodySignature`**: lá, qualquer papel
  pode assinar o mesmo termo (colaborador e/ou responsável pelo
  almoxarifado); aqui, cada assinatura pertence sempre a UM participante
  confirmando a própria presença. Por isso `participantId` é obrigatório em
  `TrainingClassSignature` e `@@unique([documentId, participantId])` —
  reassinatura não é suportada nesta fatia; uma segunda tentativa do mesmo
  participante no mesmo documento é rejeitada (`ConflictError`, HTTP 409).
- `pdfUrl` fica preparado, nunca preenchido nesta fatia (mesmo padrão de
  `CustodyDocument`).

## 2. Regras de negócio (`lib/training-documents.ts`)

- `generateAttendanceList`: exige `CompanyTraining.requiresAttendanceList`
  e a turma `IN_PROGRESS`/`COMPLETED` (`assertTrainingClassAllows(status,
  "record")`, reaproveitada de `lib/training-participants.ts` — mesma
  porta já usada para registrar presença/resultado).
- `generateCertificate`: exige `CompanyTraining.requiresCertificate` e
  `TrainingParticipant.resultStatus === "APPROVED"`.
- `signAttendanceList`: só sobre documento `ATTENDANCE_LIST` (tentar
  assinar um `CERTIFICATE` resulta em 404 — a query já filtra pelo tipo);
  participante precisa pertencer à turma e estar `ENROLLED`; segunda
  assinatura do mesmo participante no mesmo documento é rejeitada.
- `ipAddress`/`userAgent` sempre lidos dos headers da requisição, nunca do
  body — mesma regra de custódia (evidência não forjável pelo cliente).
- Toda geração/assinatura é auditada (`training_class_document.
  generate_attendance_list`/`generate_certificate`/`sign`, ver
  `lib/audit.ts`); nenhuma auditoria é gravada em caso de falha de
  validação.

## 3. APIs (Portal Empresa)

- `GET /api/training-classes/[id]/documents` — exige `training:view`.
  Lista todos os documentos da turma (lista de presença + certificados),
  com assinaturas incluídas.
- `POST /api/training-classes/[id]/documents` — exige `training:manage`.
  Corpo `{ type: "ATTENDANCE_LIST" }` ou
  `{ type: "CERTIFICATE", participantId }`.
- `POST /api/training-classes/[id]/documents/[documentId]/signatures` —
  exige `training:manage`. Corpo `{ participantId, signerName,
  signerDocument, signatureData | signatureImageUrl }`.

Todas derivam `companyId` da sessão (nunca do client) e validam que a turma/
documento/participante pertencem à empresa atual antes de qualquer leitura
ou escrita. Sem `requireTrustedMutationOrigin` (CSRF) — mesmo padrão das
demais rotas de treinamento/custódia do Portal Empresa (gap sistêmico
conhecido, não retrofitado nesta fatia).

## 4. UI

Em `/trainings/classes/[id]`, botão "Documentos" (visível a qualquer
usuário com `training:view`) abre `TrainingDocumentsDialog`:

- "Gerar lista de presença" (visível só para `training:manage`, quando
  `requiresAttendanceList` e a turma já começou) — cria um novo documento
  cobrindo os participantes `ENROLLED` no momento.
- Lista de documentos gerados, com "Visualizar" (HTML) para qualquer um.
- Para `ATTENDANCE_LIST`, uma linha por participante `ENROLLED` mostrando
  "Assinado em ..." ou um botão "Assinar" (captura em `<canvas>`, mesmo
  padrão de `custody-documents-dialog.tsx` — presencial, sem envio remoto).

Certificado é gerado a partir da tabela de participantes
(`participants-table.tsx`, ação "Gerar certificado" no menu por linha,
habilitada só quando `resultStatus === APPROVED`) — depois de gerado, ele
aparece na mesma lista do diálogo "Documentos" na próxima vez que for
aberto (não abre um visualizador próprio no momento da geração, para não
duplicar o componente de visualização).

## 5. Fora de escopo (esta fatia)

- Geração de PDF.
- Assinatura remota (WhatsApp/token público) — só presencial, mesmo device
  do gestor/instrutor.
- Portal Consultoria SST (só Portal Empresa por ora).
- Relatório de treinamento.
