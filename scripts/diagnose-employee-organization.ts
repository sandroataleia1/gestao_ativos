import "dotenv/config";
import { prisma } from "../lib/prisma";

// Sprint SST 1.4F.1, §7 — diagnóstico SOMENTE LEITURA de relações
// organizacionais de Employee: identifica Department/Position associados a
// um Employee de OUTRA Company (o que o banco hoje NÃO impede via FK — só a
// validação de aplicação em lib/employees.ts:validateEmployeeOrganizationReferences
// impede que isso seja criado; este script confirma que nada disso EXISTE
// nos dados atuais). Nunca corrige nada — só relata para revisão manual.
//
// Uso: npm run diagnose:employee-organization

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

async function main() {
  console.log("=".repeat(72));
  console.log("Diagnóstico de relações organizacionais de Employee (Sprint SST 1.4F.1)");
  console.log("=".repeat(72));
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, "://***:***@")}`);
  console.log();

  const totalEmployees = await prisma.employee.count();
  const withDepartment = await prisma.employee.count({ where: { departmentId: { not: null } } });
  const withPosition = await prisma.employee.count({ where: { positionId: { not: null } } });

  console.log(`Total de colaboradores: ${totalEmployees}`);
  console.log(`Com departmentId preenchido: ${withDepartment}`);
  console.log(`Com positionId preenchido: ${withPosition}`);
  console.log();

  // Employee.companyId != Department.companyId (cross-tenant real).
  const departmentMismatches = await prisma.$queryRaw<
    { employeeId: string; employeeCompanyId: string; departmentId: string; departmentCompanyId: string }[]
  >`
    SELECT e.id as "employeeId", e."companyId" as "employeeCompanyId",
           d.id as "departmentId", d."companyId" as "departmentCompanyId"
    FROM "Employee" e
    JOIN "Department" d ON d.id = e."departmentId"
    WHERE e."companyId" != d."companyId"
  `;

  // Employee.companyId != Position.companyId (cross-tenant real).
  const positionMismatches = await prisma.$queryRaw<
    { employeeId: string; employeeCompanyId: string; positionId: string; positionCompanyId: string }[]
  >`
    SELECT e.id as "employeeId", e."companyId" as "employeeCompanyId",
           p.id as "positionId", p."companyId" as "positionCompanyId"
    FROM "Employee" e
    JOIN "Position" p ON p.id = e."positionId"
    WHERE e."companyId" != p."companyId"
  `;

  // Referência órfã: departmentId/positionId preenchido mas o registro não
  // existe mais (não deveria ser possível hoje — Department/Position nunca
  // são apagados, ver auditoria da Sprint 1.4F.1 §2 — mas verificado mesmo
  // assim, sem presumir).
  const orphanDepartmentRefs = await prisma.$queryRaw<{ employeeId: string; departmentId: string }[]>`
    SELECT e.id as "employeeId", e."departmentId" as "departmentId"
    FROM "Employee" e
    WHERE e."departmentId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Department" d WHERE d.id = e."departmentId")
  `;
  const orphanPositionRefs = await prisma.$queryRaw<{ employeeId: string; positionId: string }[]>`
    SELECT e.id as "employeeId", e."positionId" as "positionId"
    FROM "Employee" e
    WHERE e."positionId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Position" p WHERE p.id = e."positionId")
  `;

  // Department/Position inativos (active=false) ainda associados a algum
  // Employee — não é uma falha de isolamento entre tenants, só um dado
  // informativo (nenhuma rota hoje desativa Department/Position, ver §2).
  const inactiveDepartmentRefs = await prisma.employee.count({
    where: { department: { active: false } },
  });
  const inactivePositionRefs = await prisma.employee.count({
    where: { position: { active: false } },
  });

  console.log(`Employee.companyId != Department.companyId: ${departmentMismatches.length}`);
  for (const row of departmentMismatches) {
    console.log(`  employee=${shortId(row.employeeId)} (company=${shortId(row.employeeCompanyId)}) -> department=${shortId(row.departmentId)} (company=${shortId(row.departmentCompanyId)})`);
  }
  console.log(`Employee.companyId != Position.companyId: ${positionMismatches.length}`);
  for (const row of positionMismatches) {
    console.log(`  employee=${shortId(row.employeeId)} (company=${shortId(row.employeeCompanyId)}) -> position=${shortId(row.positionId)} (company=${shortId(row.positionCompanyId)})`);
  }
  console.log(`Referência órfã a Department inexistente: ${orphanDepartmentRefs.length}`);
  console.log(`Referência órfã a Position inexistente: ${orphanPositionRefs.length}`);
  console.log(`Colaboradores com Department inativo (active=false) associado: ${inactiveDepartmentRefs}`);
  console.log(`Colaboradores com Position inativo (active=false) associado: ${inactivePositionRefs}`);
  console.log();

  const totalIssues = departmentMismatches.length + positionMismatches.length + orphanDepartmentRefs.length + orphanPositionRefs.length;
  console.log("=".repeat(72));
  if (totalIssues === 0) {
    console.log("Nenhuma inconsistência de isolamento entre tenants encontrada.");
  } else {
    console.log(`${totalIssues} inconsistência(s) de isolamento encontrada(s) — revisar manualmente.`);
  }
  console.log("Nenhum dado foi alterado — diagnóstico somente-leitura.");
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
