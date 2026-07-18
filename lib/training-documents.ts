import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit, type ActorInput } from "@/lib/audit";
import { escapeHtml } from "@/lib/html-escape";
import { formatDateOnlyBR } from "@/lib/date-only";
import { assertTrainingClassAllows } from "@/lib/training-participants";
import type { TrainingAttendanceSignatureInput } from "@/lib/validations/training-document";

// Sprint SST 1.4H, fatia 2 — documentos de turma (lista de presença
// assinada e certificado). Espelha lib/custodies/index.ts
// (docs/custody-documents.md): funções puras de montagem de HTML +
// funções de serviço que validam regra de negócio, gravam e auditam.
// Só Portal Empresa nesta fatia; Portal SST fica para depois (mesmo
// faseamento que o próprio módulo de custódia teve).

type CompanyForDocument = { name: string; document: string | null; tradeName?: string | null };

function companyDisplayName(company: CompanyForDocument): string {
  return escapeHtml(company.tradeName || company.name);
}

// ---------------------------------------------------------------------------
// Lista de presença
// ---------------------------------------------------------------------------

type AttendanceParticipant = {
  id: string;
  employee: { name: string; document: string; registration: string | null };
};

function buildAttendanceListHtml(
  trainingClass: { title: string; startsAt: Date; location: string | null },
  companyTraining: { title: string },
  company: CompanyForDocument,
  participants: AttendanceParticipant[],
): string {
  const rows = participants
    .map(
      (participant) => `
      <tr>
        <td>${escapeHtml(participant.employee.name)}</td>
        <td>${escapeHtml(participant.employee.registration ?? participant.employee.document)}</td>
        <td class="signature-cell" data-participant-id="${participant.id}"></td>
      </tr>`,
    )
    .join("");

  return `
<div class="training-attendance-list">
  <h1>Lista de Presença</h1>
  <p><strong>Empresa:</strong> ${companyDisplayName(company)}${company.document ? ` — ${escapeHtml(company.document)}` : ""}</p>
  <p><strong>Treinamento:</strong> ${escapeHtml(companyTraining.title)}</p>
  <p><strong>Turma:</strong> ${escapeHtml(trainingClass.title)}</p>
  <p><strong>Data:</strong> ${formatDateOnlyBR(trainingClass.startsAt)}</p>
  ${trainingClass.location ? `<p><strong>Local:</strong> ${escapeHtml(trainingClass.location)}</p>` : ""}
  <table>
    <thead>
      <tr><th>Colaborador</th><th>Documento/Matrícula</th><th>Assinatura</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
  `.trim();
}

/**
 * Gera a lista de presença de uma turma — 1 documento cobrindo todos os
 * participantes `ENROLLED` no momento da geração (§7 do domínio: `CANCELLED`
 * nunca é actionable). Exige `CompanyTraining.requiresAttendanceList` e a
 * mesma porta de status já usada para registrar presença/resultado
 * (`assertTrainingClassAllows`, `lib/training-participants.ts`) — só faz
 * sentido depois que a turma começou.
 */
export async function generateAttendanceList(companyId: string, actor: ActorInput, trainingClassId: string) {
  const trainingClass = await prisma.trainingClass.findFirst({
    where: { id: trainingClassId, companyId },
    include: { companyTraining: { select: { title: true, requiresAttendanceList: true } } },
  });
  if (!trainingClass) throw new NotFoundError("Turma não encontrada.");
  if (!trainingClass.companyTraining.requiresAttendanceList) {
    throw new ValidationError("Este treinamento não exige lista de presença.");
  }
  assertTrainingClassAllows(trainingClass.status, "record");

  const participants = await prisma.trainingParticipant.findMany({
    where: { trainingClassId, companyId, enrollmentStatus: "ENROLLED" },
    select: { id: true, employee: { select: { name: true, document: true, registration: true } } },
    orderBy: { employee: { name: "asc" } },
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, document: true, tradeName: true },
  });

  const contentHtml = buildAttendanceListHtml(trainingClass, trainingClass.companyTraining, company, participants);

  return prisma.$transaction(async (tx) => {
    const document = await tx.trainingClassDocument.create({
      data: { companyId, trainingClassId, type: "ATTENDANCE_LIST", contentHtml, generatedAt: new Date() },
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_class_document.generate_attendance_list",
      targetType: "TrainingClassDocument",
      targetId: document.id,
      targetLabel: trainingClass.title,
      metadata: { trainingClassId, participantCount: participants.length },
    });

    return document;
  });
}

/**
 * Registra a assinatura de UM participante numa lista de presença já
 * gerada — cada participante confirma a própria presença (diferente de
 * CustodySignature, onde qualquer papel pode assinar o mesmo termo).
 * Idempotência não é suportada nesta fatia: uma segunda tentativa do mesmo
 * participante no mesmo documento é rejeitada (ConflictError) — a unique
 * `[documentId, participantId]` no banco é a rede de segurança final contra
 * uma corrida de duas assinaturas simultâneas.
 */
export async function signAttendanceList(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  documentId: string,
  input: TrainingAttendanceSignatureInput & { ipAddress?: string; userAgent?: string },
) {
  const document = await prisma.trainingClassDocument.findFirst({
    where: { id: documentId, trainingClassId, companyId, type: "ATTENDANCE_LIST" },
  });
  if (!document) throw new NotFoundError("Documento não encontrado.");

  const participant = await prisma.trainingParticipant.findFirst({
    where: { id: input.participantId, trainingClassId, companyId, enrollmentStatus: "ENROLLED" },
    include: { employee: { select: { name: true } } },
  });
  if (!participant) throw new ValidationError("Participante não encontrado nesta turma.");

  const existing = await prisma.trainingClassSignature.findUnique({
    where: { documentId_participantId: { documentId, participantId: input.participantId } },
  });
  if (existing) throw new ConflictError("Este participante já assinou esta lista de presença.");

  return prisma.$transaction(async (tx) => {
    const signature = await tx.trainingClassSignature.create({
      data: {
        companyId,
        documentId,
        participantId: input.participantId,
        signerName: input.signerName,
        signerDocument: input.signerDocument,
        signatureImageUrl: input.signatureImageUrl,
        signatureData: input.signatureData,
        signedAt: new Date(),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_class_document.sign",
      targetType: "TrainingClassSignature",
      targetId: signature.id,
      targetLabel: participant.employee.name,
      metadata: { trainingClassId, documentId },
    });

    return signature;
  });
}

// ---------------------------------------------------------------------------
// Certificado
// ---------------------------------------------------------------------------

type CertificateParticipant = {
  employee: { name: string; document: string };
  completedAt: Date | null;
  expiresAt: Date | null;
};

function buildCertificateHtml(
  participant: CertificateParticipant,
  trainingClass: { title: string },
  companyTraining: {
    title: string;
    category: string | null;
    nrReference: string | null;
    workloadHours: number | null;
  },
  company: CompanyForDocument,
): string {
  return `
<div class="training-certificate">
  <h1>Certificado de Conclusão</h1>
  <p><strong>Empresa:</strong> ${companyDisplayName(company)}${company.document ? ` — ${escapeHtml(company.document)}` : ""}</p>
  <p>Certificamos que <strong>${escapeHtml(participant.employee.name)}</strong> (${escapeHtml(participant.employee.document)})
  concluiu com aproveitamento o treinamento <strong>${escapeHtml(companyTraining.title)}</strong>${companyTraining.nrReference ? ` (${escapeHtml(companyTraining.nrReference)})` : ""},
  turma "${escapeHtml(trainingClass.title)}"${companyTraining.workloadHours ? `, carga horária de ${companyTraining.workloadHours} hora(s)` : ""}.</p>
  <p><strong>Conclusão:</strong> ${formatDateOnlyBR(participant.completedAt)}</p>
  ${participant.expiresAt ? `<p><strong>Validade:</strong> até ${formatDateOnlyBR(participant.expiresAt)}</p>` : ""}
</div>
  `.trim();
}

/**
 * Gera o certificado individual de um participante — exige
 * `CompanyTraining.requiresCertificate` e `resultStatus: APPROVED` (nunca
 * emitido para PENDING/FAILED). Pode ser gerado mais de uma vez (2ª via),
 * mesmo padrão de CustodyDocument — nunca sobrescreve o anterior, o
 * histórico de emissões é preservado.
 */
export async function generateCertificate(
  companyId: string,
  actor: ActorInput,
  trainingClassId: string,
  participantId: string,
) {
  const participant = await prisma.trainingParticipant.findFirst({
    where: { id: participantId, trainingClassId, companyId },
    include: {
      employee: { select: { name: true, document: true } },
      trainingClass: {
        select: {
          title: true,
          companyTraining: { select: { title: true, category: true, nrReference: true, workloadHours: true, requiresCertificate: true } },
        },
      },
    },
  });
  if (!participant) throw new NotFoundError("Participante não encontrado.");
  if (!participant.trainingClass.companyTraining.requiresCertificate) {
    throw new ValidationError("Este treinamento não exige certificado.");
  }
  if (participant.resultStatus !== "APPROVED") {
    throw new ValidationError("Certificado só pode ser gerado para participante aprovado.");
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, document: true, tradeName: true },
  });

  const contentHtml = buildCertificateHtml(
    participant,
    participant.trainingClass,
    participant.trainingClass.companyTraining,
    company,
  );

  return prisma.$transaction(async (tx) => {
    const document = await tx.trainingClassDocument.create({
      data: { companyId, trainingClassId, participantId, type: "CERTIFICATE", contentHtml, generatedAt: new Date() },
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training_class_document.generate_certificate",
      targetType: "TrainingClassDocument",
      targetId: document.id,
      targetLabel: participant.employee.name,
      metadata: { trainingClassId, participantId },
    });

    return document;
  });
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getTrainingClassDocuments(companyId: string, trainingClassId: string) {
  return prisma.trainingClassDocument.findMany({
    where: { companyId, trainingClassId },
    include: { signatures: true },
    orderBy: { createdAt: "desc" },
  });
}
