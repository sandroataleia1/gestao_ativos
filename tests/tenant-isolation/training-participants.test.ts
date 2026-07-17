import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  cleanupFixtures,
  createTestCompany,
  createTestCompanyTraining,
  createTestTrainingClass,
  createTestEmployee,
  createTestUser,
  createTestProvider,
  createProviderUser,
  linkProviderToCompany,
  prisma,
  type TestSessionUser,
} from "@/tests/helpers/db";
import { mockCookies, resetCookieStore } from "@/tests/helpers/mock-request-context";
import {
  requireSstTrainingParticipantViewAccess,
  requireSstTrainingParticipantManageAccess,
  sstCanManageTrainingParticipants,
  buildSstActor,
  CompanyControlReviewInProgressError,
} from "@/lib/sst-auth";
import { ForbiddenError } from "@/lib/auth-server";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/api-errors";
import {
  enrollTrainingClassParticipants,
  cancelTrainingClassParticipant,
  reactivateTrainingClassParticipant,
  assertCapacityReductionAllowed,
  getParticipantsForClass,
  getTrainingClassParticipantSummary,
  listEligibleEmployeesForTrainingClass,
} from "@/lib/training-participants";
import { updateTrainingClass } from "@/lib/training-classes";
import { maskEmployeeDocument } from "@/lib/sst-employees";
import type {
  SstProviderCompanyStatus,
  SstProviderCompanyAccessLevel,
  SstProviderUserRole,
  CompanyControlStatus,
  CompanyOperationalStatus,
} from "@/app/generated/prisma/client";

// =============================================================================
// Sprint SST 1.4G — Participantes nas Turmas de Treinamento (inscrição
// lógica/reentrada/capacidade, ambos os portais). Cobre: invariantes de
// schema, isolamento cross-tenant, semântica de inscrição (idempotência,
// reentrada, nunca hard-delete), portas de status da turma, capacidade
// (inclusive redução e concorrência), matriz de autorização do Portal SST
// (papel x accessLevel x vínculo x estado da Company x isolamento entre
// consultorias), privacidade (documento mascarado), auditoria e regressão.
// =============================================================================

const h = vi.hoisted(() => ({ current: null as null | { user: TestSessionUser } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: mockCookies }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => h.current } } }));
function loginAs(user: TestSessionUser | null) {
  h.current = user ? { user } : null;
}
function toSession(user: { id: string; name: string; email: string; companyId: string | null }): TestSessionUser {
  return { ...user, active: true };
}

let sstParticipantsRoute: typeof import("@/app/api/sst/companies/[companyId]/classes/[classId]/participants/route");
let sstParticipantDetailRoute: typeof import("@/app/api/sst/companies/[companyId]/classes/[classId]/participants/[participantId]/route");
let sstEligibleEmployeesRoute: typeof import("@/app/api/sst/companies/[companyId]/classes/[classId]/eligible-employees/route");

const companyIds: string[] = [];
const providerIds: string[] = [];

let SYSTEM_ACTOR: { id: string; name: string };

beforeAll(async () => {
  sstParticipantsRoute = await import("@/app/api/sst/companies/[companyId]/classes/[classId]/participants/route");
  sstParticipantDetailRoute = await import(
    "@/app/api/sst/companies/[companyId]/classes/[classId]/participants/[participantId]/route"
  );
  sstEligibleEmployeesRoute = await import("@/app/api/sst/companies/[companyId]/classes/[classId]/eligible-employees/route");

  // AuditLog.actorUserId é FK real para User — logAudit falha (e a
  // transação inteira dá rollback) se o actor não existir no banco.
  // Companhia/usuário dedicados só para servir de ator nas chamadas diretas
  // de serviço deste arquivo (não representam nenhum tenant sob teste).
  const actorCompany = await createTestCompany("actor-pool");
  companyIds.push(actorCompany.id);
  const actorUser = await createTestUser(actorCompany.id, "actor");
  SYSTEM_ACTOR = { id: actorUser.id, name: actorUser.name };
});

afterEach(() => {
  loginAs(null);
  resetCookieStore();
});

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

async function makeCompany(label: string) {
  const company = await createTestCompany(label);
  companyIds.push(company.id);
  return company;
}

async function makeProvider(label: string) {
  const provider = await createTestProvider(label);
  providerIds.push(provider.id);
  return provider;
}

async function makeClass(
  companyId: string,
  overrides?: Partial<{ status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; maximumParticipants: number | null }>,
  trainingOverrides?: Partial<{ managementMode: "INTERNAL" | "EXTERNAL_PROVIDER"; managedByProviderId: string | null }>,
) {
  const companyTraining = await createTestCompanyTraining(companyId, trainingOverrides);
  const trainingClass = await createTestTrainingClass(companyId, companyTraining.id, overrides);
  return { companyTraining, trainingClass };
}

/** Chama updateTrainingClass (que exige o TrainingClassInput completo) só
 * para trocar maximumParticipants, reaproveitando os demais campos já
 * gravados na turma — evita repetir o payload inteiro em cada teste de
 * redução de capacidade. TrainingClassInput.maximumParticipants nunca é
 * `null` (só `number | undefined`, ver lib/validations/training-class.ts),
 * por isso o helper só aceita number aqui. */
async function updateMaximumParticipants(companyId: string, trainingClassId: string, maximumParticipants: number) {
  const current = await prisma.trainingClass.findUniqueOrThrow({ where: { id: trainingClassId } });
  return updateTrainingClass(companyId, SYSTEM_ACTOR, trainingClassId, current.status, {
    companyTrainingId: current.companyTrainingId,
    title: current.title,
    startsAt: current.startsAt,
    endsAt: current.endsAt ?? undefined,
    location: current.location ?? undefined,
    internalInstructor: current.internalInstructor ?? undefined,
    externalInstructor: current.externalInstructor ?? undefined,
    maximumParticipants,
    notes: current.notes ?? undefined,
    status: current.status,
  });
}

const TRUSTED_ORIGIN = "http://localhost:3010";
function jsonRequest(body: Record<string, unknown> | undefined, method: string, headerOverrides?: Record<string, string | undefined>) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: TRUSTED_ORIGIN };
  if (headerOverrides) {
    for (const [key, value] of Object.entries(headerOverrides)) {
      if (value === undefined) delete headers[key];
      else headers[key] = value;
    }
  }
  return new NextRequest(`${TRUSTED_ORIGIN}/api/x`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function sstParticipantRouteParams(companyId: string, classId: string) {
  return { params: Promise.resolve({ companyId, classId }) };
}
function sstParticipantDetailRouteParams(companyId: string, classId: string, participantId: string) {
  return { params: Promise.resolve({ companyId, classId, participantId }) };
}

type ScenarioOptions = {
  role?: SstProviderUserRole;
  accessLevel?: SstProviderCompanyAccessLevel;
  linkStatus?: SstProviderCompanyStatus;
  controlStatus?: CompanyControlStatus;
  operationalStatus?: CompanyOperationalStatus;
};

async function setupScenario(label: string, opts: ScenarioOptions = {}) {
  const company = await makeCompany(label);
  const provider = await makeProvider(label);
  const user = await createTestUser(company.id, `${label}-u`);
  await createProviderUser({ providerId: provider.id, userId: user.id, role: opts.role ?? "OWNER" });
  const link = await linkProviderToCompany({
    providerId: provider.id,
    companyId: company.id,
    status: opts.linkStatus ?? "ACTIVE",
    accessLevel: opts.accessLevel ?? "OPERATION",
  });
  const companyUpdate: Record<string, unknown> = {};
  if (opts.controlStatus) companyUpdate.controlStatus = opts.controlStatus;
  if (opts.operationalStatus) companyUpdate.operationalStatus = opts.operationalStatus;
  if (Object.keys(companyUpdate).length > 0) {
    await prisma.company.update({ where: { id: company.id }, data: companyUpdate });
  }
  return { company, provider, user, link };
}

// =============================================================================
// Invariantes de schema (migração 20260717121934_training_participant_enrollment_status)
// =============================================================================

describe("Invariantes de schema", () => {
  it("CHECK constraint rejeita ENROLLED com cancelledAt preenchido", async () => {
    const company = await makeCompany("check-enrolled-cancelled");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "TrainingParticipant" ("id", "companyId", "trainingClassId", "employeeId", "enrollmentStatus", "cancelledAt", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${company.id}, ${trainingClass.id}, ${employee.id}, 'ENROLLED', now(), now(), now())
      `,
    ).rejects.toThrow();
  });

  it("CHECK constraint rejeita CANCELLED sem cancelledAt", async () => {
    const company = await makeCompany("check-cancelled-null");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "TrainingParticipant" ("id", "companyId", "trainingClassId", "employeeId", "enrollmentStatus", "cancelledAt", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, ${company.id}, ${trainingClass.id}, ${employee.id}, 'CANCELLED', NULL, now(), now())
      `,
    ).rejects.toThrow();
  });

  it("unique (companyId, trainingClassId, employeeId) impede uma segunda linha para o mesmo colaborador na mesma turma", async () => {
    const company = await makeCompany("unique-participant");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);

    await expect(
      prisma.trainingParticipant.create({
        data: { companyId: company.id, trainingClassId: trainingClass.id, employeeId: employee.id },
      }),
    ).rejects.toThrow();

    const count = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, employeeId: employee.id } });
    expect(count).toBe(1);
  });
});

// =============================================================================
// Isolamento cross-tenant
// =============================================================================

describe("Isolamento cross-tenant", () => {
  it("não permite inscrever um Employee de outra empresa", async () => {
    const companyA = await makeCompany("cross-a");
    const companyB = await makeCompany("cross-b");
    const employeeB = await createTestEmployee(companyB.id, "emp");
    const { trainingClass } = await makeClass(companyA.id);

    await expect(
      enrollTrainingClassParticipants(companyA.id, SYSTEM_ACTOR, trainingClass.id, [employeeB.id]),
    ).rejects.toThrow(ValidationError);
  });

  it("cancelTrainingClassParticipant com companyId errado não encontra o participante (404, nunca vaza outro tenant)", async () => {
    const companyA = await makeCompany("cross-cancel-a");
    const companyB = await makeCompany("cross-cancel-b");
    const employee = await createTestEmployee(companyA.id, "emp");
    const { trainingClass } = await makeClass(companyA.id);
    const result = await enrollTrainingClassParticipants(companyA.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = result.participants[0].id;

    await expect(
      cancelTrainingClassParticipant(companyB.id, SYSTEM_ACTOR, trainingClass.id, participantId),
    ).rejects.toThrow(NotFoundError);
  });

  it("getParticipantsForClass nunca retorna participantes de outra empresa", async () => {
    const companyA = await makeCompany("scope-a");
    const companyB = await makeCompany("scope-b");
    const employeeA = await createTestEmployee(companyA.id, "empA");
    const { trainingClass: classA } = await makeClass(companyA.id);
    await enrollTrainingClassParticipants(companyA.id, SYSTEM_ACTOR, classA.id, [employeeA.id]);

    const listedForB = await getParticipantsForClass(companyB.id, classA.id);
    expect(listedForB).toHaveLength(0);
  });
});

// =============================================================================
// Semântica de inscrição — idempotência, reentrada, nunca hard-delete
// =============================================================================

describe("Semântica de inscrição", () => {
  it("cria uma inscrição ENROLLED nova e audita training_participant.enroll", async () => {
    const company = await makeCompany("enroll-new");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    const result = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);

    expect(result.created).toBe(1);
    expect(result.reactivated).toBe(0);
    expect(result.alreadyEnrolled).toBe(0);
    expect(result.participants[0].enrollmentStatus).toBe("ENROLLED");

    const audit = await prisma.auditLog.findMany({ where: { companyId: company.id, action: "training_participant.enroll" } });
    expect(audit).toHaveLength(1);
  });

  it("inscrever quem já está ENROLLED é idempotente — sem nova linha, sem nova auditoria", async () => {
    const company = await makeCompany("enroll-idempotent");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const second = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);

    expect(second.created).toBe(0);
    expect(second.alreadyEnrolled).toBe(1);

    const rows = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, employeeId: employee.id } });
    expect(rows).toBe(1);
    const audit = await prisma.auditLog.count({ where: { companyId: company.id, action: "training_participant.enroll" } });
    expect(audit).toBe(1);
  });

  it("cancelar nunca apaga a linha (remoção lógica) e preserva histórico", async () => {
    const company = await makeCompany("cancel-logical");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = enrolled.participants[0].id;

    const cancelled = await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    expect(cancelled.enrollmentStatus).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    const stillExists = await prisma.trainingParticipant.findUnique({ where: { id: participantId } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.enrollmentStatus).toBe("CANCELLED");
  });

  it("cancelar quem já está CANCELLED é idempotente — sem nova auditoria", async () => {
    const company = await makeCompany("cancel-idempotent");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = enrolled.participants[0].id;
    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    const audit = await prisma.auditLog.count({ where: { companyId: company.id, action: "training_participant.cancel" } });
    expect(audit).toBe(1);
  });

  it("reentrada antes do início da turma reaproveita a MESMA linha (mesmo id, createdAt preservado)", async () => {
    const company = await makeCompany("reentry-same-row");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);

    const first = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = first.participants[0].id;
    const originalCreatedAt = first.participants[0].createdAt;

    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    const second = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);

    expect(second.created).toBe(0);
    expect(second.reactivated).toBe(1);
    expect(second.participants).toHaveLength(1);
    expect(second.participants[0].id).toBe(participantId);
    expect(second.participants[0].createdAt.getTime()).toBe(originalCreatedAt.getTime());
    expect(second.participants[0].enrollmentStatus).toBe("ENROLLED");
    expect(second.participants[0].cancelledAt).toBeNull();

    const totalRows = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, employeeId: employee.id } });
    expect(totalRows).toBe(1);
  });

  it("reactivateTrainingClassParticipant reativa uma inscrição CANCELLED específica", async () => {
    const company = await makeCompany("reactivate-explicit");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = enrolled.participants[0].id;
    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    const reactivated = await reactivateTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    expect(reactivated.enrollmentStatus).toBe("ENROLLED");
    expect(reactivated.cancelledAt).toBeNull();
    const audit = await prisma.auditLog.count({ where: { companyId: company.id, action: "training_participant.reactivate" } });
    expect(audit).toBe(1);
  });

  it("reactivateTrainingClassParticipant é idempotente para quem já está ENROLLED", async () => {
    const company = await makeCompany("reactivate-idempotent");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = enrolled.participants[0].id;

    await reactivateTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);

    const audit = await prisma.auditLog.count({ where: { companyId: company.id, action: "training_participant.reactivate" } });
    expect(audit).toBe(0);
  });

  it("reactivateTrainingClassParticipant recusa reativar colaborador inativo", async () => {
    const company = await makeCompany("reactivate-inactive-employee");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    const participantId = enrolled.participants[0].id;
    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId);
    await prisma.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });

    await expect(
      reactivateTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantId),
    ).rejects.toThrow(ValidationError);
  });

  it("não permite inscrever colaborador inativo", async () => {
    const company = await makeCompany("enroll-inactive");
    const employee = await createTestEmployee(company.id, "emp");
    await prisma.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });
    const { trainingClass } = await makeClass(company.id);

    await expect(
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]),
    ).rejects.toThrow(ValidationError);
  });

  it("getParticipantsForClass retorna ENROLLED e CANCELLED (histórico completo)", async () => {
    const company = await makeCompany("history-both");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id);
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id, employeeB.id]);
    const participantB = await prisma.trainingParticipant.findFirstOrThrow({ where: { trainingClassId: trainingClass.id, employeeId: employeeB.id } });
    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, participantB.id);

    const all = await getParticipantsForClass(company.id, trainingClass.id);
    expect(all).toHaveLength(2);
    expect(all.some((p) => p.enrollmentStatus === "CANCELLED")).toBe(true);
    expect(all.some((p) => p.enrollmentStatus === "ENROLLED")).toBe(true);
  });
});

// =============================================================================
// Portas de status da turma (TRAINING_CLASS_PARTICIPANTS_LOCKED)
// =============================================================================

describe("Portas de status da turma", () => {
  it.each(["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const)("bloqueia inscrição quando a turma está %s", async (status) => {
    const company = await makeCompany(`lock-add-${status}`);
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, { status });

    await expect(
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]),
    ).rejects.toThrow(ValidationError);
  });

  it.each(["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const)("bloqueia remoção quando a turma está %s", async (status) => {
    const company = await makeCompany(`lock-remove-${status}`);
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, { status: "SCHEDULED" });
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status } });

    await expect(
      cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, enrolled.participants[0].id),
    ).rejects.toThrow(ValidationError);
  });

  it("permite inscrição e remoção quando a turma está SCHEDULED", async () => {
    const company = await makeCompany("lock-scheduled-ok");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, { status: "SCHEDULED" });

    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    expect(enrolled.created).toBe(1);
    await expect(
      cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, enrolled.participants[0].id),
    ).resolves.toBeTruthy();
  });
});

// =============================================================================
// Capacidade
// =============================================================================

describe("Capacidade", () => {
  it("permite inscrever até o limite exato", async () => {
    const company = await makeCompany("capacity-exact");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 2 });

    const result = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id, employeeB.id]);
    expect(result.created).toBe(2);
    expect(result.remainingCapacity).toBe(0);
  });

  it("recusa inscrição que estoura a capacidade", async () => {
    const company = await makeCompany("capacity-exceeded");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 1 });

    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]);
    await expect(
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeB.id]),
    ).rejects.toThrow(ConflictError);
  });

  it("participante CANCELLED não ocupa vaga — libera espaço para outro colaborador", async () => {
    const company = await makeCompany("capacity-freed-by-cancel");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 1 });

    const enrolledA = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]);
    await cancelTrainingClassParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, enrolledA.participants[0].id);

    await expect(
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeB.id]),
    ).resolves.toMatchObject({ created: 1 });
  });

  it("sem maximumParticipants (null), não há limite", async () => {
    const company = await makeCompany("capacity-unlimited");
    const employees = await Promise.all([1, 2, 3].map((n) => createTestEmployee(company.id, `emp${n}`)));
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: null });

    const result = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, employees.map((e) => e.id));
    expect(result.created).toBe(3);
    expect(result.remainingCapacity).toBeNull();
  });

  it("assertCapacityReductionAllowed recusa reduzir abaixo da quantidade inscrita", async () => {
    const company = await makeCompany("reduce-below");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 5 });
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id, employeeB.id]);

    await expect(
      prisma.$transaction((tx) => assertCapacityReductionAllowed(tx, trainingClass.id, 1)),
    ).rejects.toThrow(ValidationError);
  });

  it("assertCapacityReductionAllowed permite reduzir exatamente para a quantidade inscrita", async () => {
    const company = await makeCompany("reduce-exact");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 5 });
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id, employeeB.id]);

    await expect(
      prisma.$transaction((tx) => assertCapacityReductionAllowed(tx, trainingClass.id, 2)),
    ).resolves.toBeUndefined();
  });

  it("assertCapacityReductionAllowed sempre permite null (sem limite)", async () => {
    const company = await makeCompany("reduce-null");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 3 });

    await expect(
      prisma.$transaction((tx) => assertCapacityReductionAllowed(tx, trainingClass.id, null)),
    ).resolves.toBeUndefined();
  });

  it("updateTrainingClass (integração real) recusa reduzir maximumParticipants abaixo dos inscritos", async () => {
    const company = await makeCompany("update-class-reduce");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 5 });
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id, employeeB.id]);

    await expect(updateMaximumParticipants(company.id, trainingClass.id, 1)).rejects.toThrow(ValidationError);
  });

  it("getTrainingClassParticipantSummary calcula vagas restantes corretamente", async () => {
    const company = await makeCompany("summary");
    const employeeA = await createTestEmployee(company.id, "empA");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 3 });
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]);

    const summary = await getTrainingClassParticipantSummary(company.id, trainingClass.id);
    expect(summary.totalEnrolled).toBe(1);
    expect(summary.remainingCapacity).toBe(2);
  });
});

// =============================================================================
// Concorrência
// =============================================================================

describe("Concorrência", () => {
  it("última vaga: duas inscrições concorrentes para colaboradores diferentes — exatamente uma vence", async () => {
    const company = await makeCompany("race-last-seat");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 1 });

    const results = await Promise.allSettled([
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]),
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeB.id]),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const enrolledCount = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, enrollmentStatus: "ENROLLED" } });
    expect(enrolledCount).toBe(1);
  });

  it("mesmo colaborador em duas requisições concorrentes de inscrição — só uma linha é criada, nenhum erro de unique constraint vaza", async () => {
    const company = await makeCompany("race-same-employee");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: null });

    const results = await Promise.allSettled([
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]),
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]),
    ]);

    const rowCount = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, employeeId: employee.id } });
    expect(rowCount).toBe(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(String((result.reason as Error).message)).not.toMatch(/P2002|Unique constraint/i);
      }
    }
  });

  it("lote concorrente: duas inscrições em lote disputando 3 vagas para 4 pessoas — nunca estoura a capacidade", async () => {
    const company = await makeCompany("race-batch");
    const employees = await Promise.all([1, 2, 3, 4].map((n) => createTestEmployee(company.id, `emp${n}`)));
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 3 });

    const results = await Promise.allSettled([
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employees[0].id, employees[1].id]),
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employees[2].id, employees[3].id]),
    ]);

    const enrolledCount = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, enrollmentStatus: "ENROLLED" } });
    expect(enrolledCount).toBeLessThanOrEqual(3);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);
  });

  it("redução de capacidade concorrente com inscrição — o lock na turma serializa, nunca ultrapassa o novo limite", async () => {
    const company = await makeCompany("race-reduce-vs-enroll");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id, { maximumParticipants: 2 });
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]);

    const results = await Promise.allSettled([
      updateMaximumParticipants(company.id, trainingClass.id, 1),
      enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeB.id]),
    ]);

    const finalClass = await prisma.trainingClass.findUniqueOrThrow({ where: { id: trainingClass.id } });
    const enrolledCount = await prisma.trainingParticipant.count({ where: { trainingClassId: trainingClass.id, enrollmentStatus: "ENROLLED" } });
    if (finalClass.maximumParticipants !== null) {
      expect(enrolledCount).toBeLessThanOrEqual(finalClass.maximumParticipants);
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});

// =============================================================================
// Portal SST — matriz de autorização
// =============================================================================

describe("Portal SST — matriz de autorização (papel x accessLevel)", () => {
  it.each([
    ["OWNER", "OPERATION", true],
    ["OWNER", "ADMINISTRATION", true],
    ["OWNER", "VIEW", false],
    ["TECHNICIAN", "OPERATION", true],
    ["TECHNICIAN", "VIEW", false],
    ["VIEWER", "OPERATION", false],
    ["VIEWER", "VIEW", false],
  ] as const)("%s + %s -> canManage=%s (leitura sempre permitida)", async (role, accessLevel, canManageExpected) => {
    const { company, provider, user } = await setupScenario(`matrix-${role}-${accessLevel}`, { role, accessLevel });
    // assertProviderManagesCompanyTraining exige que ESTE provider gerencie
    // o CompanyTraining — a matriz de papel/accessLevel só faz sentido
    // testada sobre um treinamento já delegado a ele (isolamento entre
    // consultorias é testado à parte, mais abaixo).
    const { trainingClass } = await makeClass(company.id, undefined, {
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: provider.id,
    });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const viewCtx = await requireSstTrainingParticipantViewAccess(company.id, trainingClass.id);
    expect(viewCtx).toBeTruthy();
    expect(sstCanManageTrainingParticipants(viewCtx)).toBe(canManageExpected);

    if (canManageExpected) {
      await expect(requireSstTrainingParticipantManageAccess(company.id, trainingClass.id)).resolves.toBeTruthy();
    } else {
      await expect(requireSstTrainingParticipantManageAccess(company.id, trainingClass.id)).rejects.toThrow(ForbiddenError);
    }
  });

  it.each(["PENDING", "SUSPENDED", "REVOKED", "REJECTED"] as const)("vínculo %s não acessa (nem leitura, nem gestão)", async (linkStatus) => {
    const { company, user } = await setupScenario(`link-${linkStatus}`, { linkStatus });
    const { trainingClass } = await makeClass(company.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstTrainingParticipantViewAccess(company.id, trainingClass.id)).rejects.toThrow(ForbiddenError);
  });

  it.each(["CLAIM_PENDING", "DISPUTED"] as const)("controlStatus %s permite leitura mas bloqueia gestão (CompanyControlReviewInProgressError)", async (controlStatus) => {
    const { company, user } = await setupScenario(`control-${controlStatus}`, { controlStatus });
    const { trainingClass } = await makeClass(company.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstTrainingParticipantViewAccess(company.id, trainingClass.id)).resolves.toBeTruthy();
    await expect(requireSstTrainingParticipantManageAccess(company.id, trainingClass.id)).rejects.toThrow(CompanyControlReviewInProgressError);
  });

  it.each(["SUSPENDED", "CLOSED"] as const)("operationalStatus %s bloqueia até a leitura", async (operationalStatus) => {
    const { company, user } = await setupScenario(`op-${operationalStatus}`, { operationalStatus });
    const { trainingClass } = await makeClass(company.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstTrainingParticipantViewAccess(company.id, trainingClass.id)).rejects.toThrow(ForbiddenError);
  });

  it("turma de outra empresa não é encontrada (404, nunca vaza outro tenant)", async () => {
    const { company, user } = await setupScenario("cross-tenant-class");
    const otherCompany = await makeCompany("cross-tenant-other");
    const { trainingClass } = await makeClass(otherCompany.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    await expect(requireSstTrainingParticipantViewAccess(company.id, trainingClass.id)).rejects.toThrow(NotFoundError);
  });

  it("isolamento entre consultorias: gestão só é permitida a quem gerencia o CompanyTraining (leitura continua permissiva)", async () => {
    const company = await makeCompany("provider-isolation");
    const managingProvider = await makeProvider("managing");
    const otherProvider = await makeProvider("other");
    const { trainingClass } = await makeClass(company.id, undefined, {
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: managingProvider.id,
    });

    const otherUser = await createTestUser(company.id, "other-u");
    await createProviderUser({ providerId: otherProvider.id, userId: otherUser.id, role: "OWNER" });
    await linkProviderToCompany({ providerId: otherProvider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });
    loginAs(toSession({ id: otherUser.id, name: otherUser.name, email: otherUser.email, companyId: null }));

    await expect(requireSstTrainingParticipantViewAccess(company.id, trainingClass.id)).resolves.toBeTruthy();
    await expect(requireSstTrainingParticipantManageAccess(company.id, trainingClass.id)).rejects.toThrow(ForbiddenError);

    const managingUser = await createTestUser(company.id, "managing-u");
    await createProviderUser({ providerId: managingProvider.id, userId: managingUser.id, role: "OWNER" });
    await linkProviderToCompany({ providerId: managingProvider.id, companyId: company.id, status: "ACTIVE", accessLevel: "OPERATION" });
    loginAs(toSession({ id: managingUser.id, name: managingUser.name, email: managingUser.email, companyId: null }));

    await expect(requireSstTrainingParticipantManageAccess(company.id, trainingClass.id)).resolves.toBeTruthy();
  });
});

// =============================================================================
// Privacidade — documento mascarado (Portal SST)
// =============================================================================

describe("Privacidade — Portal SST nunca expõe o documento completo", () => {
  it("GET participantes retorna documento mascarado", async () => {
    const { company, user } = await setupScenario("mask-get");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    await enrollTrainingClassParticipants(company.id, buildSstActor({ user, providerId: (await prisma.sstProviderUser.findFirstOrThrow({ where: { userId: user.id } })).providerId }), trainingClass.id, [employee.id]);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const response = await sstParticipantsRoute.GET(jsonRequest(undefined, "GET"), sstParticipantRouteParams(company.id, trainingClass.id));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.participants[0].employee.document).not.toBe(employee.document);
    expect(data.participants[0].employee.document).toMatch(/\*/);
  });

  it("POST de inscrição retorna documento mascarado na resposta", async () => {
    const { company, provider, user } = await setupScenario("mask-post");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, undefined, {
      managementMode: "EXTERNAL_PROVIDER",
      managedByProviderId: provider.id,
    });
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const response = await sstParticipantsRoute.POST(
      jsonRequest({ employeeIds: [employee.id] }, "POST"),
      sstParticipantRouteParams(company.id, trainingClass.id),
    );
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.participants[0].employee.document).not.toBe(employee.document);
  });

  it("GET eligible-employees retorna documento mascarado e paginado", async () => {
    const { company, user } = await setupScenario("mask-eligible");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const url = new URL(`${TRUSTED_ORIGIN}/api/x?page=1&pageSize=20`);
    const request = new NextRequest(url, { method: "GET" });
    const response = await sstEligibleEmployeesRoute.GET(request, sstParticipantRouteParams(company.id, trainingClass.id));
    expect(response.status).toBe(200);
    const data = await response.json();
    const row = data.employees.find((e: { id: string }) => e.id === employee.id);
    expect(row.document).not.toBe(employee.document);
    expect(maskEmployeeDocument(employee.document)).toBe(row.document);
  });
});

// =============================================================================
// CSRF (Portal SST — requireTrustedMutationOrigin)
// =============================================================================

describe("CSRF — rotas de mutação do Portal SST", () => {
  it("POST sem origin confiável é rejeitado", async () => {
    const { company, user } = await setupScenario("csrf-post");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const response = await sstParticipantsRoute.POST(
      jsonRequest({ employeeIds: [employee.id] }, "POST", { origin: "http://evil.example" }),
      sstParticipantRouteParams(company.id, trainingClass.id),
    );
    expect(response.status).toBe(403);
  });

  it("DELETE sem origin confiável é rejeitado", async () => {
    const { company, user } = await setupScenario("csrf-delete");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id);
    const provider = await prisma.sstProviderUser.findFirstOrThrow({ where: { userId: user.id } });
    const enrolled = await enrollTrainingClassParticipants(company.id, buildSstActor({ user, providerId: provider.providerId }), trainingClass.id, [employee.id]);
    loginAs(toSession({ id: user.id, name: user.name, email: user.email, companyId: null }));

    const response = await sstParticipantDetailRoute.DELETE(
      jsonRequest(undefined, "DELETE", { origin: "http://evil.example" }),
      sstParticipantDetailRouteParams(company.id, trainingClass.id, enrolled.participants[0].id),
    );
    expect(response.status).toBe(403);
  });
});

// =============================================================================
// Regressão — presença/resultado (escopo 1.4H, função preservada)
// =============================================================================

describe("Regressão", () => {
  it("updateParticipant (presença/resultado) continua funcionando para participante ENROLLED", async () => {
    const { updateParticipant } = await import("@/lib/training-participants");
    const company = await makeCompany("regression-update-participant");
    const employee = await createTestEmployee(company.id, "emp");
    const { trainingClass } = await makeClass(company.id, { status: "SCHEDULED" });
    const enrolled = await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employee.id]);
    await prisma.trainingClass.update({ where: { id: trainingClass.id }, data: { status: "IN_PROGRESS" } });

    const updated = await updateParticipant(company.id, SYSTEM_ACTOR, trainingClass.id, enrolled.participants[0].id, {
      attendanceStatus: "PRESENT",
    });

    expect(updated.attendanceStatus).toBe("PRESENT");
  });

  it("listEligibleEmployeesForTrainingClass indica enrollmentStatus correto por colaborador", async () => {
    const company = await makeCompany("regression-eligible");
    const employeeA = await createTestEmployee(company.id, "empA");
    const employeeB = await createTestEmployee(company.id, "empB");
    const { trainingClass } = await makeClass(company.id);
    await enrollTrainingClassParticipants(company.id, SYSTEM_ACTOR, trainingClass.id, [employeeA.id]);

    const { rows } = await listEligibleEmployeesForTrainingClass(company.id, trainingClass.id, { page: 1, pageSize: 20 });
    const rowA = rows.find((r) => r.id === employeeA.id);
    const rowB = rows.find((r) => r.id === employeeB.id);
    expect(rowA?.enrollmentStatus).toBe("ENROLLED");
    expect(rowB?.enrollmentStatus).toBeNull();
  });
});
