import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  createTestCompany,
  createTestEmployee,
  createTestProvider,
  linkProviderToCompany,
  prisma,
} from "@/tests/helpers/db";

// Sprint Demo Comercial SST 1.0, Parte 13 — 6 testes de interface/dados
// (casos 15-20 da especificação): escopo do dashboard/listagem de empresas
// da consultoria + idempotência do seed/reset de demonstração.
//
// Este arquivo NÃO mocka @/lib/auth (os casos 18-20 chamam seedSstDemo(),
// que precisa do fluxo real de signUpEmail do Better Auth) — mesmo motivo
// documentado em register-creates-membership.test.ts. Os casos 15-17 não
// tocam auth nenhuma (chamam lib/sst-dashboard.ts diretamente).

const companyIds: string[] = [];
const providerIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds, providerIds });
  await prisma.$disconnect();
});

describe("Sprint Demo Comercial SST 1.0, Parte 13 — dashboard/listagem escopados por consultoria", () => {
  it("caso 15: dashboard não conta empresas sem vínculo ACTIVE", async () => {
    const { getProviderDashboardSummary } = await import("@/lib/sst-dashboard");

    const provider = await createTestProvider("dash-no-active");
    providerIds.push(provider.id);
    const activeCompany = await createTestCompany("dash-no-active-active");
    const pendingCompany = await createTestCompany("dash-no-active-pending");
    companyIds.push(activeCompany.id, pendingCompany.id);

    await createTestEmployee(activeCompany.id, "dash-no-active-emp");
    await createTestEmployee(pendingCompany.id, "dash-no-active-pending-emp");

    await linkProviderToCompany({ providerId: provider.id, companyId: activeCompany.id, status: "ACTIVE" });
    await linkProviderToCompany({ providerId: provider.id, companyId: pendingCompany.id, status: "PENDING" });

    const summary = await getProviderDashboardSummary(provider.id);
    expect(summary.companyCount).toBe(1);
    expect(summary.activeEmployeeCount).toBe(1);
  });

  it("caso 16: métricas respeitam o escopo da consultoria (não somam dados de outro provider)", async () => {
    const { getProviderDashboardSummary } = await import("@/lib/sst-dashboard");

    const providerA = await createTestProvider("dash-scope-a");
    const providerB = await createTestProvider("dash-scope-b");
    providerIds.push(providerA.id, providerB.id);
    const companyA = await createTestCompany("dash-scope-company-a");
    const companyB = await createTestCompany("dash-scope-company-b");
    companyIds.push(companyA.id, companyB.id);

    await createTestEmployee(companyA.id, "dash-scope-emp-a1");
    await createTestEmployee(companyA.id, "dash-scope-emp-a2");
    await createTestEmployee(companyB.id, "dash-scope-emp-b1");
    await createTestEmployee(companyB.id, "dash-scope-emp-b2");
    await createTestEmployee(companyB.id, "dash-scope-emp-b3");

    await linkProviderToCompany({ providerId: providerA.id, companyId: companyA.id, status: "ACTIVE" });
    await linkProviderToCompany({ providerId: providerB.id, companyId: companyB.id, status: "ACTIVE" });

    const summaryA = await getProviderDashboardSummary(providerA.id);
    const summaryB = await getProviderDashboardSummary(providerB.id);

    expect(summaryA.companyCount).toBe(1);
    expect(summaryA.activeEmployeeCount).toBe(2);
    expect(summaryB.companyCount).toBe(1);
    expect(summaryB.activeEmployeeCount).toBe(3);
  });

  it("caso 17: listagem de empresas não vaza empresa sem nenhum vínculo SstProviderCompany", async () => {
    const { getLinkedCompaniesWithMetrics } = await import("@/lib/sst-dashboard");

    const provider = await createTestProvider("list-no-link");
    providerIds.push(provider.id);
    const linkedCompany = await createTestCompany("list-no-link-linked");
    const unlinkedCompany = await createTestCompany("list-no-link-unlinked");
    companyIds.push(linkedCompany.id, unlinkedCompany.id);

    await linkProviderToCompany({ providerId: provider.id, companyId: linkedCompany.id, status: "ACTIVE" });
    // unlinkedCompany: propositalmente sem SstProviderCompany nenhum.

    const companies = await getLinkedCompaniesWithMetrics(provider.id);
    const ids = companies.map((c) => c.companyId);
    expect(ids).toContain(linkedCompany.id);
    expect(ids).not.toContain(unlinkedCompany.id);
  });
});

describe("Sprint Demo Comercial SST 1.0, Parte 13 — idempotência do seed de demonstração", () => {
  const DEMO_SUFFIX = "(Demo SST)";
  const DEMO_EMAILS = ["sst@demo.com", "sst-tech@demo.com", "sst-viewer@demo.com"];
  const DEMO_PROVIDER_NAME = "Consultoria Segura SST";

  async function cleanupSeedFixtures() {
    const provider = await prisma.sstProvider.findFirst({ where: { name: DEMO_PROVIDER_NAME } });
    if (provider) {
      // Sprint Comercial SST 1.4 (extensão) — o seed agora inclui uma
      // empresa UNCLAIMED pré-cadastrada por este provider
      // (Company.createdByProviderId, onDelete: Restrict) — precisa ser
      // desvinculada antes do DELETE do provider, senão a FK bloqueia.
      await prisma.company.updateMany({
        where: { createdByProviderId: provider.id },
        data: { createdByProviderId: null },
      });
      await prisma.sstProviderUser.deleteMany({ where: { providerId: provider.id } });
      await prisma.sstProviderCompany.deleteMany({ where: { providerId: provider.id } });
      await prisma.sstProvider.deleteMany({ where: { id: provider.id } });
    }

    // Os 3 usuários de portal precisam ser removidos ANTES das empresas de
    // demo — a primeira delas (Metalúrgica Alfa) é a âncora de
    // `User.companyId` (FK NOT NULL) desses usuários (ver ensurePortalUser
    // em prisma/seed-sst-demo.ts); apagar a empresa primeiro violaria a FK.
    const demoUsers = await prisma.user.findMany({ where: { email: { in: DEMO_EMAILS } } });
    const demoUserIds = demoUsers.map((u) => u.id);
    if (demoUserIds.length > 0) {
      await prisma.companyMembership.deleteMany({ where: { userId: { in: demoUserIds } } });
      await prisma.account.deleteMany({ where: { userId: { in: demoUserIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: demoUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: demoUserIds } } });
    }

    const demoCompanies = await prisma.company.findMany({ where: { name: { endsWith: DEMO_SUFFIX } } });
    const demoCompanyIds = demoCompanies.map((c) => c.id);
    if (demoCompanyIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.trainingParticipant.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.trainingClass.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.companyTraining.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.employee.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.department.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.position.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.sstProviderCompany.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.companyMembership.deleteMany({ where: { companyId: { in: demoCompanyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: demoCompanyIds } } });
    }
  }

  afterAll(async () => {
    await cleanupSeedFixtures();
  });

  it("caso 18/19: rodar o seed duas vezes não duplica empresas, equipe nem colaboradores", async () => {
    const { seedSstDemo } = await import("../../prisma/seed-sst-demo");

    await cleanupSeedFixtures();
    await seedSstDemo();
    await seedSstDemo();

    const companies = await prisma.company.findMany({ where: { name: { endsWith: DEMO_SUFFIX } } });
    // 5 empresas de conformidade + 3 de estado do vínculo (Sprint Comercial
    // SST 1.4: UNCLAIMED provisória, PENDING, REJECTED — ver
    // prisma/seed-sst-demo.ts).
    expect(companies).toHaveLength(8);
    const names = companies.map((c) => c.name).sort();
    expect(new Set(names).size).toBe(8); // nenhum nome duplicado

    const provider = await prisma.sstProvider.findFirstOrThrow({ where: { name: DEMO_PROVIDER_NAME } });
    const providerUsers = await prisma.sstProviderUser.findMany({ where: { providerId: provider.id } });
    expect(providerUsers).toHaveLength(3);

    // Sprint Demo Comercial SST 1.3, caso 15 — os 3 usuários de portal usam
    // nomes humanos fictícios (não mais "Técnico Consultoria Segura SST",
    // que misturava papel + nome da consultoria e parecia artificial na
    // demonstração); rodar o seed de novo não deve alterar nem duplicar.
    const [owner, technician, viewer] = await Promise.all([
      prisma.user.findUnique({ where: { email: "sst@demo.com" } }),
      prisma.user.findUnique({ where: { email: "sst-tech@demo.com" } }),
      prisma.user.findUnique({ where: { email: "sst-viewer@demo.com" } }),
    ]);
    expect(owner?.name).toBe("Mariana Costa");
    expect(technician?.name).toBe("Rafael Almeida");
    expect(viewer?.name).toBe("Juliana Santos");

    const companyIdsFromSeed = companies.map((c) => c.id);
    const employeeCount = await prisma.employee.count({ where: { companyId: { in: companyIdsFromSeed } } });
    // 4 + 5 + 4 + 3 + 5 = 21 colaboradores fictícios no total, fixo pelo
    // script — rodar de novo não pode alterar esse número.
    expect(employeeCount).toBe(21);
  });

  it("caso 20: reset remove somente as empresas de demonstração identificadas, nunca outras empresas do banco", async () => {
    const { seedSstDemo } = await import("../../prisma/seed-sst-demo");
    const { resetSstDemo } = await import("../../prisma/reset-sst-demo");

    await cleanupSeedFixtures();
    await seedSstDemo();

    // Empresa de controle, SEM o sufixo "(Demo SST)" — nunca deve ser
    // afetada pelo reset, mesmo estando vinculada ao mesmo provider.
    const provider = await prisma.sstProvider.findFirstOrThrow({ where: { name: DEMO_PROVIDER_NAME } });
    const controlCompany = await createTestCompany("reset-scope-control");
    companyIds.push(controlCompany.id);
    const controlEmployee = await createTestEmployee(controlCompany.id, "reset-scope-control-emp");
    await linkProviderToCompany({ providerId: provider.id, companyId: controlCompany.id, status: "ACTIVE" });

    const before = await prisma.company.count({ where: { name: { endsWith: DEMO_SUFFIX } } });
    expect(before).toBe(8);

    await resetSstDemo();

    const after = await prisma.company.count({ where: { name: { endsWith: DEMO_SUFFIX } } });
    expect(after).toBe(0);

    const controlStillThere = await prisma.company.findUnique({ where: { id: controlCompany.id } });
    expect(controlStillThere).not.toBeNull();
    const controlEmployeeStillThere = await prisma.employee.findUnique({ where: { id: controlEmployee.id } });
    expect(controlEmployeeStillThere).not.toBeNull();

    // Refaz o seed para não deixar o provider "órfão" de empresas para o
    // próximo teste/execução manual desta suíte.
    await seedSstDemo();
  });
});
