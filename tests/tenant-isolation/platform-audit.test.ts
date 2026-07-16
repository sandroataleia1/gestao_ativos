import { afterAll, describe, expect, it } from "vitest";

import { createTestCompanyWithRoles, createTestUser, prisma } from "@/tests/helpers/db";
import { logPlatformAudit } from "@/lib/platform-audit";

// Sprint SST 1.4D.1, §16, itens 15-27 — auditoria persistente global
// (PlatformAuditLog). Cobre persistência básica, o guard de segredos e o
// comportamento transacional (§6: nunca persistir um evento de uma
// transação que foi revertida).

const companyIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
  await prisma.platformAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  for (const userId of userIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  for (const companyId of companyIds) {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

async function makeUser(label: string) {
  const company = await createTestCompanyWithRoles(label);
  companyIds.push(company.id);
  const user = await createTestUser(company.id, `${label}-u`);
  userIds.push(user.id);
  return user;
}

describe("logPlatformAudit — persistência básica", () => {
  it("cria uma linha em PlatformAuditLog com os campos informados", async () => {
    const user = await makeUser("audit-basic");

    await logPlatformAudit({
      action: "platform_admin.access_granted",
      severity: "CRITICAL",
      source: "CLI",
      actorUserId: user.id,
      targetType: "PlatformUser",
      targetId: "fake-target-id",
      reason: "Motivo de teste sem segredo.",
      metadata: { created: true },
    });

    const row = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.access_granted", actorUserId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row?.severity).toBe("CRITICAL");
    expect(row?.source).toBe("CLI");
    expect(row?.targetType).toBe("PlatformUser");
    expect(row?.reason).toBe("Motivo de teste sem segredo.");
    expect((row?.metadata as { created?: boolean })?.created).toBe(true);
  });

  it("nunca exige companyId (representa ação sem tenant natural)", async () => {
    const user = await makeUser("audit-no-company");
    await logPlatformAudit({
      action: "platform_admin.exposure_diagnostic_executed",
      severity: "INFO",
      source: "CLI",
      actorUserId: user.id,
      metadata: { since: "2026-07-10T00:00:00Z", until: "2026-07-15T00:00:00Z" },
    });
    const row = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.exposure_diagnostic_executed", actorUserId: user.id },
    });
    expect(row).not.toBeNull();
    // O tipo do model nunca tem um campo companyId — reforçado estruturalmente.
    expect(row).not.toHaveProperty("companyId");
  });

  it("actorUserId pode ser null (ex.: FIRST_BOOTSTRAP, sem ator preexistente)", async () => {
    await logPlatformAudit({
      action: "platform_admin.first_bootstrap",
      severity: "CRITICAL",
      source: "FIRST_BOOTSTRAP",
      actorUserId: null,
      metadata: { note: "sem ator anterior" },
    });
    const row = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.first_bootstrap", source: "FIRST_BOOTSTRAP", actorUserId: null },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
  });

  it("rejeita metadata/reason contendo segredo e nunca persiste a linha", async () => {
    const user = await makeUser("audit-secret-guard");
    const before = await prisma.platformAuditLog.count({ where: { actorUserId: user.id } });

    await expect(
      logPlatformAudit({
        action: "platform_admin.access_granted",
        severity: "CRITICAL",
        source: "CLI",
        actorUserId: user.id,
        reason: "confirmado, senha: abc12345",
      }),
    ).rejects.toThrow();

    const after = await prisma.platformAuditLog.count({ where: { actorUserId: user.id } });
    expect(after).toBe(before);
  });
});

describe("logPlatformAudit — comportamento transacional (§6)", () => {
  it("evento gravado dentro de uma transação revertida nunca persiste", async () => {
    const user = await makeUser("audit-tx-rollback");

    await expect(
      prisma.$transaction(async (tx) => {
        await logPlatformAudit(
          {
            action: "platform_admin.access_revoked",
            severity: "CRITICAL",
            source: "CLI",
            actorUserId: user.id,
            metadata: {},
          },
          tx,
        );
        throw new Error("forçando rollback da transação de teste");
      }),
    ).rejects.toThrow("forçando rollback");

    const row = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.access_revoked", actorUserId: user.id },
    });
    expect(row).toBeNull();
  });

  it("evento gravado dentro de uma transação commitada persiste normalmente", async () => {
    const user = await makeUser("audit-tx-commit");

    await prisma.$transaction(async (tx) => {
      await logPlatformAudit(
        {
          action: "platform_admin.access_revoked",
          severity: "CRITICAL",
          source: "CLI",
          actorUserId: user.id,
          metadata: {},
        },
        tx,
      );
    });

    const row = await prisma.platformAuditLog.findFirst({
      where: { action: "platform_admin.access_revoked", actorUserId: user.id },
    });
    expect(row).not.toBeNull();
  });
});
