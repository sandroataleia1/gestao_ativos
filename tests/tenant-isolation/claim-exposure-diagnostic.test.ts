import { afterAll, describe, expect, it } from "vitest";

import { createTestCompanyWithRoles, createTestUser, createTestMembership, prisma } from "@/tests/helpers/db";
import { runExposureDiagnosticQuery, recordExposureDiagnosticExecuted } from "@/lib/claim-exposure-diagnostic";

// Sprint SST 1.4D.2, §2/§9 — prova, por teste de integração real (não só
// leitura de código), que o diagnóstico de exposição:
//   1. nunca altera Company/User/CompanyMembership/CompanyClaimRequest/
//      SstProviderCompany/UserRole (contagens de linhas idênticas antes e
//      depois de rodar a consulta + persistir o evento de auditoria);
//   2. a ÚNICA escrita realizada é o INSERT append-only em PlatformAuditLog.

const companyIds: string[] = [];

afterAll(async () => {
  for (const companyId of companyIds) {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

async function countAllProtectedTables() {
  const [company, user, companyMembership, companyClaimRequest, sstProviderCompany, userRole] = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.companyMembership.count(),
    prisma.companyClaimRequest.count(),
    prisma.sstProviderCompany.count(),
    prisma.userRole.count(),
  ]);
  return { company, user, companyMembership, companyClaimRequest, sstProviderCompany, userRole };
}

describe("Diagnóstico de exposição — garantia de não-alteração de dados de negócio", () => {
  it("runExposureDiagnosticQuery nunca altera Company/User/CompanyMembership/CompanyClaimRequest/SstProviderCompany/UserRole", async () => {
    // Cria alguma massa de dados real para a consulta ter o que classificar
    // (não é o ponto do teste que a classificação esteja correta — isso já
    // é coberto por tests/claim-exposure.test.ts — só que rodar a consulta
    // sobre dados reais não escreve nada fora de PlatformAuditLog).
    const company = await createTestCompanyWithRoles("exposure-diag-noop");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "exposure-diag-noop-u");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    const before = await countAllProtectedTables();
    const platformAuditBefore = await prisma.platformAuditLog.count();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = new Date();
    const result = await runExposureDiagnosticQuery(since, until);
    expect(result.totalActiveMemberships).toBeGreaterThan(0);

    const afterQuery = await countAllProtectedTables();
    expect(afterQuery).toEqual(before);

    // A consulta em si (sem persistir o evento) não grava nada, nem em
    // PlatformAuditLog.
    const platformAuditAfterQuery = await prisma.platformAuditLog.count();
    expect(platformAuditAfterQuery).toBe(platformAuditBefore);
  });

  it("recordExposureDiagnosticExecuted é a ÚNICA escrita: só cresce PlatformAuditLog, nunca as tabelas de negócio", async () => {
    const before = await countAllProtectedTables();
    const platformAuditBefore = await prisma.platformAuditLog.count();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = new Date();
    await recordExposureDiagnosticExecuted(since, until);

    const after = await countAllProtectedTables();
    expect(after).toEqual(before);

    const platformAuditAfter = await prisma.platformAuditLog.count();
    expect(platformAuditAfter).toBe(platformAuditBefore + 1);

    const event = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.exposure_diagnostic_executed" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect((event?.metadata as { since?: string; until?: string })?.since).toBe(since.toISOString());
    expect((event?.metadata as { since?: string; until?: string })?.until).toBe(until.toISOString());
  });

  it("uma execução completa (query + registro) altera só PlatformAuditLog — nunca as 6 tabelas protegidas", async () => {
    const before = await countAllProtectedTables();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = new Date();
    await recordExposureDiagnosticExecuted(since, until);
    await runExposureDiagnosticQuery(since, until);

    const after = await countAllProtectedTables();
    expect(after).toEqual(before);
  });
});
