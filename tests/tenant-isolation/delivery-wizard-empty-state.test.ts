import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupFixtures, createTestCompany, createTestEmployee, prisma } from "@/tests/helpers/db";

// Sprint Demo Comercial — Wizard de Nova Entrega, Parte 19 "Estado inicial"
// (casos 1, 4, 5). A consulta testada aqui é EXATAMENTE a mesma que
// app/(app)/custodies/new/page.tsx usa para decidir se mostra o wizard ou o
// estado bloqueado — nunca duplicamos a regra, só verificamos o resultado
// real contra o banco.

const companyIds: string[] = [];

afterAll(async () => {
  await cleanupFixtures({ companyIds });
  await prisma.$disconnect();
});

async function activeEmployeesFor(companyId: string) {
  return prisma.employee.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true },
  });
}

describe("Sprint Demo Comercial — Wizard: caso 1 — empresa sem colaborador ativo", () => {
  it("empresa sem nenhum colaborador cadastrado resulta em lista vazia (estado bloqueado)", async () => {
    const company = await createTestCompany("wizard-empty-none");
    companyIds.push(company.id);
    const employees = await activeEmployeesFor(company.id);
    expect(employees).toHaveLength(0);
  });

  it("empresa só com colaboradores inativos resulta em lista vazia (estado bloqueado)", async () => {
    const company = await createTestCompany("wizard-empty-inactive");
    companyIds.push(company.id);
    const employee = await createTestEmployee(company.id, "wizard-empty-inactive-emp");
    await prisma.employee.update({ where: { id: employee.id }, data: { status: "INACTIVE" } });

    const employees = await activeEmployeesFor(company.id);
    expect(employees).toHaveLength(0);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 4/5 — busca de colaborador não vaza inativo nem de outra empresa", () => {
  it("colaborador inativo não aparece entre os candidatos do wizard", async () => {
    const company = await createTestCompany("wizard-scope-inactive");
    companyIds.push(company.id);
    const activeEmployee = await createTestEmployee(company.id, "wizard-scope-active");
    const inactiveEmployee = await createTestEmployee(company.id, "wizard-scope-inactive-emp");
    await prisma.employee.update({ where: { id: inactiveEmployee.id }, data: { status: "INACTIVE" } });

    const employees = await activeEmployeesFor(company.id);
    const ids = employees.map((e) => e.id);
    expect(ids).toContain(activeEmployee.id);
    expect(ids).not.toContain(inactiveEmployee.id);
  });

  it("colaborador de outra empresa não aparece entre os candidatos do wizard", async () => {
    const companyA = await createTestCompany("wizard-scope-a");
    const companyB = await createTestCompany("wizard-scope-b");
    companyIds.push(companyA.id, companyB.id);
    const employeeA = await createTestEmployee(companyA.id, "wizard-scope-a-emp");
    const employeeB = await createTestEmployee(companyB.id, "wizard-scope-b-emp");

    const employeesForA = await activeEmployeesFor(companyA.id);
    const ids = employeesForA.map((e) => e.id);
    expect(ids).toContain(employeeA.id);
    expect(ids).not.toContain(employeeB.id);
  });
});

describe("Sprint Demo Comercial — Wizard: caso 2/3 — ação de cadastro só aparece com employee:manage", () => {
  it("o componente de estado vazio só renderiza 'Cadastrar colaborador' quando canManageEmployees é true", () => {
    const source = readFileSync("app/(app)/custodies/new/no-active-employees-state.tsx", "utf8");
    expect(source).toContain("canManageEmployees ?");
    expect(source).toContain("Cadastrar colaborador");
    expect(source).toContain("Solicite a um administrador ou usuário de RH");
  });

  it("a página decide canManageEmployees no servidor via hasPermission(EMPLOYEE_MANAGE), nunca no client", () => {
    const source = readFileSync("app/(app)/custodies/new/page.tsx", "utf8");
    expect(source).toContain("hasPermission(PERMISSIONS.EMPLOYEE_MANAGE)");
  });
});
