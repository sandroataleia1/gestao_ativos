import "dotenv/config";

import { prisma } from "@/lib/prisma";

/**
 * Diagnóstico SOMENTE-LEITURA pré-M2 (CompanyMembership) — Sprint 0.4.
 *
 * Levanta tudo que pode impedir um backfill 1:1 de `User.companyId` para
 * `CompanyMembership` (ver docs/adr/ADR-001, seção 2/3). NUNCA escreve no
 * banco: só `findMany`/`count`/`groupBy`. Seguro rodar em qualquer ambiente.
 *
 * Uso:
 *   npx tsx scripts/diagnose-pre-m2.ts            # saída legível
 *   npx tsx scripts/diagnose-pre-m2.ts --json      # saída JSON
 *   npm run diagnose:pre-m2 [-- --json]
 *
 * Código de saída: 0 sempre que a leitura completar (mesmo achando
 * problemas) — só falha técnica (ex.: banco indisponível) retorna 1.
 */

function describeDatabaseTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL não definido)";
  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\//, "") || "(sem nome)";
    return `${url.hostname}:${url.port || "5432"}/${dbName}`;
  } catch {
    return "(connection string não parseável)";
  }
}

async function main() {
  const asJson = process.argv.includes("--json");

  // 1) total de usuários
  const totalUsers = await prisma.user.count();

  // 2/3) usuários com/sem companyId — companyId é NOT NULL no schema atual,
  // então "sem companyId" só pode significar string vazia (defensivo).
  const usersWithCompanyId = await prisma.user.count({ where: { companyId: { not: "" } } });
  const usersWithoutCompanyId = await prisma.user.count({ where: { companyId: "" } });

  // 4) usuários cujo companyId não referencia uma Company existente —
  // LEFT JOIN via query raw só de leitura (sem alterar nada).
  const orphanUsers = await prisma.$queryRaw<Array<{ id: string; email: string; companyId: string }>>`
    SELECT u.id, u.email, u."companyId"
    FROM "User" u
    LEFT JOIN "Company" c ON c.id = u."companyId"
    WHERE c.id IS NULL
  `;

  // 5) empresas sem nenhum usuário
  const companiesWithUserCount = await prisma.company.findMany({
    select: { id: true, name: true, _count: { select: { users: true } } },
  });
  const companiesWithoutUsers = companiesWithUserCount.filter((c) => c._count.users === 0);

  // 6) empresas sem usuário com papel administrativo (Role.name === "ADMIN")
  const companiesWithAdmin = await prisma.userRole.findMany({
    where: { role: { name: "ADMIN" } },
    select: { companyId: true },
    distinct: ["companyId"],
  });
  const companiesWithAdminIds = new Set(companiesWithAdmin.map((r) => r.companyId));
  const companiesWithoutAdmin = companiesWithUserCount.filter((c) => !companiesWithAdminIds.has(c.id));

  // 7) total de UserRole
  const totalUserRoles = await prisma.userRole.count();

  // 8) UserRole em que Role.companyId difere de User.companyId — não deveria
  // acontecer hoje (UserRole.companyId é sempre setado igual ao User no
  // fluxo atual), mas verificamos como pré-condição do invariante do ADR-001 §3.
  const userRoleCompanyMismatch = await prisma.$queryRaw<
    Array<{ userRoleId: string; userId: string; userCompanyId: string; roleCompanyId: string; userRoleCompanyId: string }>
  >`
    SELECT
      ur.id AS "userRoleId",
      ur."userId" AS "userId",
      u."companyId" AS "userCompanyId",
      r."companyId" AS "roleCompanyId",
      ur."companyId" AS "userRoleCompanyId"
    FROM "UserRole" ur
    JOIN "User" u ON u.id = ur."userId"
    JOIN "Role" r ON r.id = ur."roleId"
    WHERE r."companyId" != u."companyId" OR ur."companyId" != u."companyId"
  `;

  // 9) usuários com papéis (UserRole) pertencentes a mais de uma empresa —
  // hoje UserRole.companyId é sempre igual a User.companyId (não há
  // multi-empresa ainda), então isto deve ser 0; serve de pré-condição.
  // groupBy por userId não distingue companyId distintos diretamente, então
  // agregamos manualmente a partir da lista bruta.
  const userRolesRaw = await prisma.userRole.findMany({ select: { userId: true, companyId: true } });
  const companiesByUser = new Map<string, Set<string>>();
  for (const row of userRolesRaw) {
    const set = companiesByUser.get(row.userId) ?? new Set<string>();
    set.add(row.companyId);
    companiesByUser.set(row.userId, set);
  }
  const usersWithRolesInMultipleCompanies = [...companiesByUser.entries()]
    .filter(([, companies]) => companies.size > 1)
    .map(([userId, companies]) => ({ userId, companyIds: [...companies] }));

  // 10) usuários que também possuem SstProviderUser
  const usersWithSstProviderUser = await prisma.user.findMany({
    where: { sstProviderUsers: { some: {} } },
    select: { id: true, email: true, companyId: true, sstProviderUsers: { select: { providerId: true, role: true, active: true } } },
  });

  // 11) usuários duplicados por e-mail — User.email é @unique no schema,
  // então isto deveria ser sempre 0; verificado via groupBy por segurança
  // (ex.: se a constraint tiver sido violada por uma migration antiga ou
  // manipulação direta no banco).
  const emailGroups = await prisma.user.groupBy({
    by: ["email"],
    _count: { email: true },
    having: { email: { _count: { gt: 1 } } },
  });

  // 12) qualquer situação que impeça o backfill 1:1 — resumo derivado dos
  // pontos acima (não é uma query nova, é a agregação dos achados).
  const blockers: string[] = [];
  if (usersWithoutCompanyId > 0) blockers.push(`${usersWithoutCompanyId} usuário(s) sem companyId.`);
  if (orphanUsers.length > 0) blockers.push(`${orphanUsers.length} usuário(s) com companyId órfão (empresa inexistente).`);
  if (userRoleCompanyMismatch.length > 0) {
    blockers.push(`${userRoleCompanyMismatch.length} UserRole com Role.companyId ou UserRole.companyId divergente de User.companyId.`);
  }
  if (usersWithRolesInMultipleCompanies.length > 0) {
    blockers.push(`${usersWithRolesInMultipleCompanies.length} usuário(s) com UserRole em mais de uma empresa.`);
  }
  if (emailGroups.length > 0) blockers.push(`${emailGroups.length} e-mail(s) duplicado(s) entre usuários.`);

  const report = {
    generatedAt: new Date().toISOString(),
    database: describeDatabaseTarget(),
    totals: {
      totalUsers,
      usersWithCompanyId,
      usersWithoutCompanyId,
      orphanUsersCount: orphanUsers.length,
      companiesWithoutUsersCount: companiesWithoutUsers.length,
      companiesWithoutAdminCount: companiesWithoutAdmin.length,
      totalUserRoles,
      userRoleCompanyMismatchCount: userRoleCompanyMismatch.length,
      usersWithRolesInMultipleCompaniesCount: usersWithRolesInMultipleCompanies.length,
      usersWithSstProviderUserCount: usersWithSstProviderUser.length,
      duplicateEmailGroupsCount: emailGroups.length,
    },
    details: {
      orphanUsers,
      companiesWithoutUsers: companiesWithoutUsers.map((c) => ({ id: c.id, name: c.name })),
      companiesWithoutAdmin: companiesWithoutAdmin.map((c) => ({ id: c.id, name: c.name })),
      userRoleCompanyMismatch,
      usersWithRolesInMultipleCompanies,
      usersWithSstProviderUser: usersWithSstProviderUser.map((u) => ({
        id: u.id,
        email: u.email,
        companyId: u.companyId,
        providers: u.sstProviderUsers,
      })),
      duplicateEmailGroups: emailGroups,
    },
    backfillBlockers: blockers,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push("Diagnóstico pré-M2 (CompanyMembership) — SOMENTE LEITURA");
  lines.push("=".repeat(72));
  lines.push(`Gerado em:  ${report.generatedAt}`);
  lines.push(`Banco:      ${report.database}`);
  lines.push("");
  lines.push("Resumo:");
  lines.push(`  1) Total de usuários ............................................ ${totalUsers}`);
  lines.push(`  2) Usuários com companyId ........................................ ${usersWithCompanyId}`);
  lines.push(`  3) Usuários sem companyId ........................................ ${usersWithoutCompanyId}`);
  lines.push(`  4) Usuários com companyId órfão (empresa inexistente) ........... ${orphanUsers.length}`);
  lines.push(`  5) Empresas sem usuários ......................................... ${companiesWithoutUsers.length}`);
  lines.push(`  6) Empresas sem usuário com papel ADMIN .......................... ${companiesWithoutAdmin.length}`);
  lines.push(`  7) Total de UserRole ............................................. ${totalUserRoles}`);
  lines.push(`  8) UserRole com Role.companyId != User.companyId ................ ${userRoleCompanyMismatch.length}`);
  lines.push(`  9) Usuários com papéis em mais de uma empresa .................... ${usersWithRolesInMultipleCompanies.length}`);
  lines.push(` 10) Usuários que também possuem SstProviderUser ................... ${usersWithSstProviderUser.length}`);
  lines.push(` 11) Grupos de e-mail duplicado entre usuários ..................... ${emailGroups.length}`);
  lines.push("");

  if (orphanUsers.length > 0) {
    lines.push(`Usuários com companyId órfão (${orphanUsers.length}):`);
    for (const u of orphanUsers) lines.push(`  - ${u.id} | ${u.email} | companyId="${u.companyId}"`);
    lines.push("");
  }

  if (companiesWithoutUsers.length > 0) {
    lines.push(`Empresas sem nenhum usuário (${companiesWithoutUsers.length}):`);
    for (const c of companiesWithoutUsers) lines.push(`  - ${c.id} | ${c.name}`);
    lines.push("");
  }

  if (companiesWithoutAdmin.length > 0) {
    lines.push(`Empresas sem usuário ADMIN (${companiesWithoutAdmin.length}):`);
    for (const c of companiesWithoutAdmin) lines.push(`  - ${c.id} | ${c.name}`);
    lines.push("");
  }

  if (userRoleCompanyMismatch.length > 0) {
    lines.push(`UserRole com companyId divergente (${userRoleCompanyMismatch.length}):`);
    for (const r of userRoleCompanyMismatch) {
      lines.push(
        `  - UserRole ${r.userRoleId} | user ${r.userId} | User.companyId=${r.userCompanyId} | Role.companyId=${r.roleCompanyId} | UserRole.companyId=${r.userRoleCompanyId}`,
      );
    }
    lines.push("");
  }

  if (usersWithRolesInMultipleCompanies.length > 0) {
    lines.push(`Usuários com UserRole em mais de uma empresa (${usersWithRolesInMultipleCompanies.length}):`);
    for (const u of usersWithRolesInMultipleCompanies) lines.push(`  - ${u.userId} | empresas: ${u.companyIds.join(", ")}`);
    lines.push("");
  }

  if (usersWithSstProviderUser.length > 0) {
    lines.push(`Usuários com acesso ao Portal Consultoria (SstProviderUser) (${usersWithSstProviderUser.length}):`);
    for (const u of usersWithSstProviderUser) {
      lines.push(`  - ${u.id} | ${u.email} | User.companyId=${u.companyId} | providers=${JSON.stringify(u.sstProviderUsers)}`);
    }
    lines.push("");
  }

  if (emailGroups.length > 0) {
    lines.push(`E-mails duplicados entre usuários (${emailGroups.length}):`);
    for (const g of emailGroups) lines.push(`  - "${g.email}" aparece ${g._count.email}x`);
    lines.push("");
  }

  lines.push("Bloqueadores do backfill 1:1 (User.companyId -> CompanyMembership):");
  if (blockers.length === 0) {
    lines.push("  Nenhum bloqueador encontrado — backfill 1:1 é seguro de executar.");
  } else {
    for (const b of blockers) lines.push(`  - ${b}`);
  }
  lines.push("");
  lines.push("Nenhum dado foi modificado. Diagnóstico somente-leitura.");

  console.log(lines.join("\n"));
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Falha técnica ao executar o diagnóstico:");
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
