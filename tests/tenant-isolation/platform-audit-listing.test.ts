import { afterAll, describe, expect, it } from "vitest";

import { createTestCompanyWithRoles, createTestUser, prisma } from "@/tests/helpers/db";
import { logPlatformAudit } from "@/lib/platform-audit";
import { listPlatformAuditLogs } from "@/lib/platform-audit-listing";

// Sprint SST 1.4D.1, §12 — camada de leitura de /platform-admin/audit.
// Nunca exibe e-mail integral, nunca vaza metadata bruta (só o resumo
// sanitizado calculado internamente).

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

describe("listPlatformAuditLogs", () => {
  it("pagina, filtra por ação/severidade e mascara o e-mail do ator; nunca expõe metadata bruta", async () => {
    const user = await makeUser("audit-list-basic");
    await logPlatformAudit({
      action: "platform_admin.access_granted",
      severity: "CRITICAL",
      source: "CLI",
      actorUserId: user.id,
      metadata: { created: true, note: "informação operacional comum, sem nada sensível" },
    });

    const result = await listPlatformAuditLogs({ action: "platform_admin.access_granted", severity: "CRITICAL", pageSize: 100 });
    const item = result.items.find((i) => i.actorEmailMasked && user.email.startsWith(i.actorEmailMasked.split("*")[0]));
    expect(item).toBeTruthy();
    expect(item?.actorEmailMasked).not.toBe(user.email);
    expect(item?.actorEmailMasked).toContain("@");
    // O item nunca carrega a metadata bruta — só os campos definidos em PlatformAuditListItem.
    expect(item).not.toHaveProperty("metadata");
  });

  it("filtra por período (since/until)", async () => {
    const user = await makeUser("audit-list-period");
    await logPlatformAudit({
      action: "platform_admin.exposure_diagnostic_executed",
      severity: "INFO",
      source: "CLI",
      actorUserId: user.id,
      metadata: {},
    });

    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    const inRange = await listPlatformAuditLogs({ since: past, until: future, pageSize: 200 });
    expect(inRange.items.some((i) => i.action === "platform_admin.exposure_diagnostic_executed")).toBe(true);

    const outOfRange = await listPlatformAuditLogs({ since: future, pageSize: 200 });
    expect(outOfRange.items.some((i) => i.action === "platform_admin.exposure_diagnostic_executed")).toBe(false);
  });

  it("paginação nunca carrega tudo de uma vez", async () => {
    const result = await listPlatformAuditLogs({ page: 1, pageSize: 1 });
    expect(result.items.length).toBeLessThanOrEqual(1);
    expect(result.pageSize).toBe(1);
  });
});
