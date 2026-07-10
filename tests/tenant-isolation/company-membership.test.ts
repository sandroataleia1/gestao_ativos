import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";

import {
  cleanupFixtures,
  createTestCompany,
  createTestMembership,
  createTestUser,
  prisma,
} from "@/tests/helpers/db";
import { runBackfill } from "@/scripts/backfill-company-memberships";

// Testes de modelo/integridade do M2A (CompanyMembership) + M2B (backfill).
// Não envolvem requireCompany()/rotas — a tabela ainda não é lida por
// nenhum código de produção nesta sprint (ver docs/adr/ADR-001).

const companyIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

describe("Caso 1 — unique(userId, companyId) impede duplicidade", () => {
  it("uma segunda membership para o mesmo par é rejeitada", async () => {
    const company = await createTestCompany("m2-dup");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "dup-user");

    await createTestMembership({ userId: user.id, companyId: company.id });

    await expect(
      createTestMembership({ userId: user.id, companyId: company.id }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("Caso 2 — usuário com memberships em duas empresas diferentes", () => {
  it("cria uma membership por empresa sem conflito", async () => {
    const companyA = await createTestCompany("m2-multiA");
    const companyB = await createTestCompany("m2-multiB");
    companyIds.push(companyA.id, companyB.id);
    const user = await createTestUser(companyA.id, "multi-user");

    await createTestMembership({ userId: user.id, companyId: companyA.id });
    await createTestMembership({ userId: user.id, companyId: companyB.id });

    const memberships = await prisma.companyMembership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(2);
    expect(new Set(memberships.map((m) => m.companyId))).toEqual(new Set([companyA.id, companyB.id]));
  });
});

describe("Caso 3 — status default", () => {
  it("membership criada sem status explícito começa como INVITED", async () => {
    const company = await createTestCompany("m2-invited");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "invited-user");

    const membership = await createTestMembership({ userId: user.id, companyId: company.id });

    expect(membership.status).toBe("INVITED");
  });
});

describe("Casos 4 e 5 — backfill cria ACTIVE e é idempotente", () => {
  // Nota: runBackfill() varre TODOS os usuários do banco (é uma operação
  // global, como seria em produção) — não só os deste describe. Os casos 1-3
  // acima já deixaram memberships INVITED "legadas" de outros pares; ao
  // rodar aqui, o backfill as encontra e as classifica como conflito (SEM
  // alterá-las — é exatamente essa garantia de não-sobrescrita que
  // queremos, verificada abaixo). Por isso as asserções deste bloco são
  // sempre escopadas ao PAR específico criado aqui, nunca aos totais globais.

  it("caso 4: backfill (--apply) cria membership ACTIVE com activatedAt preenchido para um par legado", async () => {
    const company = await createTestCompany("m2-backfill");
    companyIds.push(company.id);
    // Usuário "legado": tem User.companyId mas NENHUMA membership ainda —
    // exatamente o cenário que o backfill deve cobrir.
    const user = await createTestUser(company.id, "legacy-user");

    const { summary, outcomes } = await runBackfill("apply");
    expect(summary.created).toBeGreaterThanOrEqual(1);

    const ourOutcome = outcomes.find((o) => o.pair.userId === user.id && o.pair.companyId === company.id);
    expect(ourOutcome?.kind).toBe("created");

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.activatedAt).not.toBeNull();
    expect(membership?.invitedByUserId).toBeNull();

    // Prova adicional da garantia "nunca sobrescreve": as memberships
    // INVITED criadas pelos casos 1-3 continuam INVITED depois de um
    // backfill global — o backfill as reportou como conflito, não as tocou.
    const untouchedConflicts = outcomes.filter((o) => o.kind === "conflict");
    for (const c of untouchedConflicts) {
      const row = await prisma.companyMembership.findUnique({
        where: { userId_companyId: { userId: c.pair.userId, companyId: c.pair.companyId } },
      });
      expect(row?.status).toBe("INVITED");
    }
  });

  it("caso 5: segunda execução do backfill não cria novas linhas", async () => {
    const before = await prisma.companyMembership.count();

    const { summary: dryRunSummary } = await runBackfill("dry-run");
    expect(dryRunSummary.wouldCreate).toBe(0);

    const { summary: applySummary } = await runBackfill("apply");
    expect(applySummary.created).toBe(0);

    const after = await prisma.companyMembership.count();
    expect(after).toBe(before);
  });
});

describe("Caso 6 — UserRole sozinho não é membership", () => {
  it("um usuário com UserRole mas sem CompanyMembership não tem nenhuma linha na tabela", async () => {
    const company = await createTestCompany("m2-userrole-only");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "userrole-only");

    // Atribui um papel sem nunca criar CompanyMembership — replica o estado
    // pré-M2 (RBAC funcionando sem o conceito de membership).
    const role = await prisma.role.create({
      data: { companyId: company.id, name: "ROLE_SEM_MEMBERSHIP", isSystem: false },
    });
    await prisma.userRole.create({ data: { userId: user.id, companyId: company.id, roleId: role.id } });

    const membership = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
    });
    expect(membership).toBeNull();
  });
});

describe("Caso 7 — exclusão de usuário remove suas memberships (Cascade)", () => {
  it("deletar o User remove a CompanyMembership associada", async () => {
    const company = await createTestCompany("m2-cascade-user");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "cascade-user");
    const membership = await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    await prisma.user.delete({ where: { id: user.id } });

    const found = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(found).toBeNull();
  });
});

describe("Caso 8 — exclusão de empresa com memberships é bloqueada (Restrict)", () => {
  it("deletar a Company falha enquanto existir CompanyMembership vinculada", async () => {
    const company = await createTestCompany("m2-restrict-company");
    companyIds.push(company.id);
    const user = await createTestUser(company.id, "restrict-user");
    await createTestMembership({ userId: user.id, companyId: company.id, status: "ACTIVE" });

    await expect(prisma.company.delete({ where: { id: company.id } })).rejects.toMatchObject({
      code: "P2003",
    });

    // A empresa permanece — cleanupFixtures cuida da remoção correta ao final
    // (remove a membership antes da empresa).
    const stillExists = await prisma.company.findUnique({ where: { id: company.id } });
    expect(stillExists).not.toBeNull();
  });
});

describe("Caso 9 — remoção do convidador preserva a membership (SetNull)", () => {
  it("deletar invitedByUser mantém a membership e zera invitedByUserId", async () => {
    const company = await createTestCompany("m2-inviter");
    companyIds.push(company.id);
    const inviter = await createTestUser(company.id, "inviter");
    const invited = await createTestUser(company.id, "invited");
    const membership = await createTestMembership({
      userId: invited.id,
      companyId: company.id,
      status: "ACTIVE",
      invitedByUserId: inviter.id,
    });
    expect(membership.invitedByUserId).toBe(inviter.id);

    await prisma.user.delete({ where: { id: inviter.id } });

    const found = await prisma.companyMembership.findUnique({ where: { id: membership.id } });
    expect(found).not.toBeNull();
    expect(found?.userId).toBe(invited.id);
    expect(found?.invitedByUserId).toBeNull();
  });
});

describe("Caso 10 — banco de teste reconstruível por migrations reais", () => {
  it("o histórico de migrations aplicadas neste banco bate com prisma/migrations (sem db push)", async () => {
    const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
    const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;

    // Se este banco tivesse sido sincronizado via `db push` (em vez de
    // `migrate deploy`/`migrate reset`), a tabela `_prisma_migrations` nem
    // existiria ou estaria vazia — a query acima já teria falhado ou
    // retornado 0 linhas.
    expect(applied.length).toBe(migrationFolders.length);
    for (const m of applied) {
      expect(migrationFolders).toContain(m.migration_name);
      expect(m.finished_at).not.toBeNull();
      expect(m.rolled_back_at).toBeNull();
    }
  });
});
