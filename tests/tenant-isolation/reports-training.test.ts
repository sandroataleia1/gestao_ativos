import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestCompanyTraining,
  createTestTrainingClass,
  createTestEmployee,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { getTrainingsReport } from "@/lib/reports";
import { enrollTrainingClassParticipants, updateParticipant, cancelTrainingClassParticipant } from "@/lib/training-participants";

// =============================================================================
// Sprint SST 1.4H, fatia 3 — relatório de treinamento. Cobre: isolamento
// cross-tenant, exclusão de CANCELLED, filtros (treinamento/colaborador/
// resultado), e as flags de vencimento (expired/expiringSoon).
// =============================================================================

const companyIds: string[] = [];

async function makeCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  return company;
}

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

describe("getTrainingsReport", () => {
  it("nunca inclui participantes de outra empresa", async () => {
    const companyA = await makeCompany("report-cross-a");
    const companyB = await makeCompany("report-cross-b");
    const userA = await createTestUser(companyA.id, "actor");
    const actor = { id: userA.id, name: userA.name };
    const trainingA = await createTestCompanyTraining(companyA.id);
    const classA = await createTestTrainingClass(companyA.id, trainingA.id);
    const employeeA = await createTestEmployee(companyA.id, "empA");
    await enrollTrainingClassParticipants(companyA.id, actor, classA.id, [employeeA.id]);

    const reportA = await getTrainingsReport(companyA.id);
    const reportB = await getTrainingsReport(companyB.id);

    expect(reportA.rows.some((row) => row.employeeName === employeeA.name)).toBe(true);
    expect(reportB.rows.some((row) => row.employeeName === employeeA.name)).toBe(false);
  });

  it("exclui inscrições CANCELLED", async () => {
    const company = await makeCompany("report-cancelled");
    const userActor = await createTestUser(company.id, "actor");
    const actor = { id: userActor.id, name: userActor.name };
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id);
    const employee = await createTestEmployee(company.id, "emp");
    const enrolled = await enrollTrainingClassParticipants(company.id, actor, trainingClass.id, [employee.id]);
    await cancelTrainingClassParticipant(company.id, actor, trainingClass.id, enrolled.participants[0].id);

    const report = await getTrainingsReport(company.id);

    expect(report.rows.some((row) => row.employeeName === employee.name)).toBe(false);
    expect(report.summary.total).toBe(0);
  });

  it("filtra por companyTrainingId, employeeId e resultStatus", async () => {
    const company = await makeCompany("report-filters");
    const userActor = await createTestUser(company.id, "actor");
    const actor = { id: userActor.id, name: userActor.name };
    const trainingX = await createTestCompanyTraining(company.id, undefined, "training-x");
    const trainingY = await createTestCompanyTraining(company.id, undefined, "training-y");
    const classX = await createTestTrainingClass(company.id, trainingX.id, { status: "SCHEDULED" });
    const classY = await createTestTrainingClass(company.id, trainingY.id, { status: "SCHEDULED" });
    const employeeX = await createTestEmployee(company.id, "empX");
    const employeeY = await createTestEmployee(company.id, "empY");
    await enrollTrainingClassParticipants(company.id, actor, classX.id, [employeeX.id]);
    const enrolledY = await enrollTrainingClassParticipants(company.id, actor, classY.id, [employeeY.id]);
    await prisma.trainingClass.update({ where: { id: classY.id }, data: { status: "IN_PROGRESS" } });
    await updateParticipant(company.id, actor, classY.id, enrolledY.participants[0].id, { resultStatus: "APPROVED" });

    const byTraining = await getTrainingsReport(company.id, { companyTrainingId: trainingX.id });
    expect(byTraining.rows).toHaveLength(1);
    expect(byTraining.rows[0].employeeName).toBe(employeeX.name);

    const byEmployee = await getTrainingsReport(company.id, { employeeId: employeeY.id });
    expect(byEmployee.rows).toHaveLength(1);
    expect(byEmployee.rows[0].employeeName).toBe(employeeY.name);

    const byResult = await getTrainingsReport(company.id, { resultStatus: "APPROVED" });
    expect(byResult.rows).toHaveLength(1);
    expect(byResult.rows[0].employeeName).toBe(employeeY.name);

    const all = await getTrainingsReport(company.id);
    expect(all.summary.total).toBe(2);
    const pendingCount = all.summary.byResult.find((r) => r.resultStatus === "PENDING")?.count ?? 0;
    const approvedCount = all.summary.byResult.find((r) => r.resultStatus === "APPROVED")?.count ?? 0;
    expect(pendingCount).toBe(1);
    expect(approvedCount).toBe(1);
  });

  it("marca expired/expiringSoon corretamente conforme expiresAt", async () => {
    const company = await makeCompany("report-expiry");
    const userActor = await createTestUser(company.id, "actor");
    const actor = { id: userActor.id, name: userActor.name };
    const training = await createTestCompanyTraining(company.id);
    const trainingClass = await createTestTrainingClass(company.id, training.id, { status: "SCHEDULED" });
    const employeeExpired = await createTestEmployee(company.id, "expired");
    const employeeSoon = await createTestEmployee(company.id, "soon");
    const enrolledExpired = await enrollTrainingClassParticipants(company.id, actor, trainingClass.id, [
      employeeExpired.id,
    ]);
    const enrolledSoon = await enrollTrainingClassParticipants(company.id, actor, trainingClass.id, [employeeSoon.id]);
    await prisma.trainingParticipant.update({
      where: { id: enrolledExpired.participants[0].id },
      data: { expiresAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });
    await prisma.trainingParticipant.update({
      where: { id: enrolledSoon.participants[0].id },
      data: { expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) },
    });

    const report = await getTrainingsReport(company.id);

    const expiredRow = report.rows.find((row) => row.employeeName === employeeExpired.name);
    const soonRow = report.rows.find((row) => row.employeeName === employeeSoon.name);
    expect(expiredRow?.expired).toBe(true);
    expect(expiredRow?.expiringSoon).toBe(false);
    expect(soonRow?.expired).toBe(false);
    expect(soonRow?.expiringSoon).toBe(true);
    expect(report.summary.expired).toBe(1);
    expect(report.summary.expiringSoon).toBe(1);
  });
});
