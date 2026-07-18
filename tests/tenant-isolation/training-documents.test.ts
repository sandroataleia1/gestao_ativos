import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestCompanyTraining,
  createTestTrainingClass,
  createTestEmployee,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api-errors";
import {
  generateAttendanceList,
  generateCertificate,
  signAttendanceList,
  getTrainingClassDocuments,
} from "@/lib/training-documents";
import { enrollTrainingClassParticipants, updateParticipant } from "@/lib/training-participants";

// =============================================================================
// Sprint SST 1.4H, fatia 2 — certificado + lista de presença assinada.
// Cobre: portas de negócio (requiresAttendanceList/requiresCertificate,
// status da turma, resultStatus APPROVED), isolamento cross-tenant,
// assinatura (participante correto, duplicata rejeitada) e auditoria.
// =============================================================================

const companyIds: string[] = [];
let ACTOR: { id: string; name: string };

beforeAll(async () => {
  const actorCompany = await createTestCompany("doc-actor-pool");
  companyIds.push(actorCompany.id);
  const actorUser = await createTestUser(actorCompany.id, "doc-actor");
  ACTOR = { id: actorUser.id, name: actorUser.name };
});

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function makeCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  return company;
}

async function makeApprovedParticipant(
  companyId: string,
  trainingClassId: string,
  label: string,
  employeeOverrides: Partial<{ status: "ACTIVE" | "INACTIVE" }> = {},
) {
  const employee = await createTestEmployee(companyId, label);
  if (employeeOverrides.status === "INACTIVE") {
    await prisma.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });
  }
  const enrolled = await enrollTrainingClassParticipants(companyId, ACTOR, trainingClassId, [employee.id]);
  const participantId = enrolled.participants[0].id;
  await prisma.trainingClass.update({ where: { id: trainingClassId }, data: { status: "IN_PROGRESS" } });
  await updateParticipant(companyId, ACTOR, trainingClassId, participantId, { resultStatus: "APPROVED" });
  return { employee, participantId };
}

// =============================================================================
// Lista de presença
// =============================================================================

describe("generateAttendanceList", () => {
  it("gera a lista cobrindo só participantes ENROLLED (CANCELLED fica de fora)", async () => {
    const company = await makeCompany("attendance-basic");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [
      employeeA.id,
      employeeB.id,
    ]);
    const { cancelTrainingClassParticipant } = await import("@/lib/training-participants");
    await cancelTrainingClassParticipant(company.id, ACTOR, trainingClass.id, enrolled.participants[0].id);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });

    const document = await generateAttendanceList(company.id, ACTOR, trainingClass.id);

    expect(document.type).toBe("ATTENDANCE_LIST");
    expect(document.contentHtml).toContain(employeeB.name);
    expect(document.contentHtml).not.toContain(employeeA.name);

    const audit = await prisma.auditLog.count({
      where: { companyId: company.id, action: "training_class_document.generate_attendance_list" },
    });
    expect(audit).toBe(1);
  });

  it("recusa gerar quando o treinamento não exige lista de presença", async () => {
    const company = await makeCompany("attendance-not-required");
    const training = await createTestCompanyTraining(company.id, { requiresAttendanceList: false });
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "IN_PROGRESS" });

    await expect(generateAttendanceList(company.id, ACTOR, trainingClass.id)).rejects.toThrow(ValidationError);
  });

  it("recusa gerar enquanto a turma ainda está SCHEDULED", async () => {
    const company = await makeCompany("attendance-scheduled");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });

    await expect(generateAttendanceList(company.id, ACTOR, trainingClass.id)).rejects.toThrow(ValidationError);
  });

  it("turma de outra empresa não é encontrada (404, nunca vaza outro tenant)", async () => {
    const companyA = await makeCompany("attendance-cross-a");
    const companyB = await makeCompany("attendance-cross-b");
    const training = await createTestCompanyTraining(companyB.id);
    const trainingClass = await createTestTrainingClass(companyB.id, training.id, { status: "IN_PROGRESS" });

    await expect(generateAttendanceList(companyA.id, ACTOR, trainingClass.id)).rejects.toThrow(NotFoundError);
  });
});

describe("signAttendanceList", () => {
  it("registra a assinatura de um participante e audita", async () => {
    const company = await makeCompany("sign-basic");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });
    const document = await generateAttendanceList(company.id, ACTOR, trainingClass.id);

    const signature = await signAttendanceList(company.id, ACTOR, trainingClass.id, document.id, {
      participantId: enrolled.participants[0].id,
      signerName: employee.name,
      signerDocument: employee.document,
      signatureData: "data:image/png;base64,abc",
    });

    expect(signature.participantId).toBe(enrolled.participants[0].id);
    const audit = await prisma.auditLog.count({
      where: { companyId: company.id, action: "training_class_document.sign" },
    });
    expect(audit).toBe(1);
  });

  it("recusa uma segunda assinatura do mesmo participante no mesmo documento", async () => {
    const company = await makeCompany("sign-duplicate");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });
    const document = await generateAttendanceList(company.id, ACTOR, trainingClass.id);
    const signaturePayload = {
      participantId: enrolled.participants[0].id,
      signerName: employee.name,
      signerDocument: employee.document,
      signatureData: "data:image/png;base64,abc",
    };
    await signAttendanceList(company.id, ACTOR, trainingClass.id, document.id, signaturePayload);

    await expect(
      signAttendanceList(company.id, ACTOR, trainingClass.id, document.id, signaturePayload),
    ).rejects.toThrow(ConflictError);
  });

  it("recusa assinatura de participante que não está mais ENROLLED", async () => {
    const company = await makeCompany("sign-cancelled");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });
    const document = await generateAttendanceList(company.id, ACTOR, trainingClass.id);
    await prisma.trainingParticipant.update({
      where: { id: enrolled.participants[0].id },
      data: { enrollmentStatus: "CANCELLED", cancelledAt: new Date() },
    });

    await expect(
      signAttendanceList(company.id, ACTOR, trainingClass.id, document.id, {
        participantId: enrolled.participants[0].id,
        signerName: employee.name,
        signerDocument: employee.document,
        signatureData: "data:image/png;base64,abc",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("recusa assinar um documento que não é lista de presença (CERTIFICATE)", async () => {
    const company = await makeCompany("sign-wrong-doc-type");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const { employee, participantId } = await makeApprovedParticipant(company.id, trainingClass.id, "emp");
    const certificate = await generateCertificate(company.id, ACTOR, trainingClass.id, participantId);

    await expect(
      signAttendanceList(company.id, ACTOR, trainingClass.id, certificate.id, {
        participantId,
        signerName: employee.name,
        signerDocument: employee.document,
        signatureData: "data:image/png;base64,abc",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

// =============================================================================
// Certificado
// =============================================================================

describe("generateCertificate", () => {
  it("gera o certificado quando o participante está APPROVED", async () => {
    const company = await makeCompany("cert-basic");
    const training = await createTestCompanyTraining(company.id, { workloadHours: 8 });
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const { employee, participantId } = await makeApprovedParticipant(company.id, trainingClass.id, "emp");

    const document = await generateCertificate(company.id, ACTOR, trainingClass.id, participantId);

    expect(document.type).toBe("CERTIFICATE");
    expect(document.participantId).toBe(participantId);
    expect(document.contentHtml).toContain(employee.name);

    const audit = await prisma.auditLog.count({
      where: { companyId: company.id, action: "training_class_document.generate_certificate" },
    });
    expect(audit).toBe(1);
  });

  it("recusa gerar para participante PENDING (ainda não avaliado)", async () => {
    const company = await makeCompany("cert-pending");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [employee.id]);

    await expect(
      generateCertificate(company.id, ACTOR, trainingClass.id, enrolled.participants[0].id),
    ).rejects.toThrow(ValidationError);
  });

  it("recusa gerar para participante FAILED", async () => {
    const company = await makeCompany("cert-failed");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });
    await updateParticipant(company.id, ACTOR, trainingClass.id, enrolled.participants[0].id, {
      resultStatus: "FAILED",
    });

    await expect(
      generateCertificate(company.id, ACTOR, trainingClass.id, enrolled.participants[0].id),
    ).rejects.toThrow(ValidationError);
  });

  it("recusa gerar quando o treinamento não exige certificado", async () => {
    const company = await makeCompany("cert-not-required");
    const training = await createTestCompanyTraining(company.id, { requiresCertificate: false });
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const { participantId } = await makeApprovedParticipant(company.id, trainingClass.id, "emp");

    await expect(generateCertificate(company.id, ACTOR, trainingClass.id, participantId)).rejects.toThrow(
      ValidationError,
    );
  });

  it("participante de outra empresa não é encontrado (404, nunca vaza outro tenant)", async () => {
    const companyA = await makeCompany("cert-cross-a");
    const companyB = await makeCompany("cert-cross-b");
    const trainingB = await createTestCompanyTraining(companyB.id);
    const trainingClassB = await createTestTrainingClass(companyB.id, trainingB.id, { status: "SCHEDULED" });
    const { participantId } = await makeApprovedParticipant(companyB.id, trainingClassB.id, "emp");

    await expect(
      generateCertificate(companyA.id, ACTOR, trainingClassB.id, participantId),
    ).rejects.toThrow(NotFoundError);
  });

  it("permite gerar uma segunda via sem apagar a primeira (histórico preservado)", async () => {
    const company = await makeCompany("cert-second-copy");
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const { participantId } = await makeApprovedParticipant(company.id, trainingClass.id, "emp");

    const first = await generateCertificate(company.id, ACTOR, trainingClass.id, participantId);
    const second = await generateCertificate(company.id, ACTOR, trainingClass.id, participantId);

    expect(first.id).not.toBe(second.id);
    const count = await prisma.trainingClassDocument.count({ where: { participantId, type: "CERTIFICATE" } });
    expect(count).toBe(2);
  });
});

describe("getTrainingClassDocuments", () => {
  it("lista documentos com assinaturas incluídas, escopado por empresa", async () => {
    const companyA = await makeCompany("list-scope-a");
    const companyB = await makeCompany("list-scope-b");
    const trainingA = await createTestCompanyTraining(companyA.id);
    const classA = await createTestTrainingClass(companyA.id, trainingA.id, { status: "SCHEDULED" });
    const employee = await createTestEmployee(companyA.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(companyA.id, ACTOR, classA.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: classA.id }, data: { status: "IN_PROGRESS" } });
    const document = await generateAttendanceList(companyA.id, ACTOR, classA.id);
    await signAttendanceList(companyA.id, ACTOR, classA.id, document.id, {
      participantId: enrolled.participants[0].id,
      signerName: employee.name,
      signerDocument: employee.document,
      signatureData: "data:image/png;base64,abc",
    });

    const listedForA = await getTrainingClassDocuments(companyA.id, classA.id);
    const listedForB = await getTrainingClassDocuments(companyB.id, classA.id);

    expect(listedForA).toHaveLength(1);
    expect(listedForA[0].signatures).toHaveLength(1);
    expect(listedForB).toHaveLength(0);
  });
});
