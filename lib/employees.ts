import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit, type ActorInput } from "@/lib/audit";
import type { EmployeeInput } from "@/lib/validations/employee";

// Mensagem única para departmentId/positionId inválidos (Sprint SST 1.4F.1,
// §4/§8) — nunca revela qual dos dois campos falhou, nem que o id pertence a
// OUTRA Company (a diferença entre "não existe" e "existe em outro tenant" é
// invisível de propósito, tanto para quem tentaria descobrir outra empresa
// quanto para reduzir a superfície de enumeração).
const ORG_REFERENCE_INVALID_MESSAGE = "O setor ou cargo selecionado não está disponível para esta empresa.";

/**
 * Garante que `departmentId`/`positionId` (quando informados) existem e
 * pertencem à empresa atual — nunca confia apenas no formato do id vindo do
 * client. Sprint SST 1.4F.1, §5: recebe `tx` e roda DENTRO da mesma
 * transação do create/update que a chama — a validação e a gravação
 * acontecem atomicamente, nunca como duas operações separadas que uma
 * corrida poderia desalinhar. `select` mínimo (só `id`) — nunca retorna
 * nome/dados do registro validado, mesmo internamente.
 *
 * Department/Position são imutáveis após criados (nenhuma rota expõe
 * update/delete para os dois — só POST de criação, ver
 * app/api/departments/route.ts e app/api/positions/route.ts) — não existe
 * hoje um cenário real de "companyId trocado" ou "registro removido entre a
 * validação e o create", mas a validação transacional é mantida como defesa
 * em profundidade e para provar atomicidade, não porque uma corrida
 * conhecida exista.
 */
export async function validateEmployeeOrganizationReferences(params: {
  companyId: string;
  departmentId?: string | null;
  positionId?: string | null;
  tx: Prisma.TransactionClient | typeof prisma;
}) {
  const { companyId, departmentId, positionId, tx } = params;

  if (departmentId) {
    const department = await tx.department.findFirst({
      where: { id: departmentId, companyId },
      select: { id: true },
    });
    if (!department) {
      throw new ValidationError(ORG_REFERENCE_INVALID_MESSAGE);
    }
  }

  if (positionId) {
    const position = await tx.position.findFirst({
      where: { id: positionId, companyId },
      select: { id: true },
    });
    if (!position) {
      throw new ValidationError(ORG_REFERENCE_INVALID_MESSAGE);
    }
  }
}

export const employeeListInclude = {
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
} as const;

export const EMPLOYEE_SORT_FIELDS = ["name", "document", "department", "position", "status"] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

function buildEmployeeOrderBy(
  sort: EmployeeSortField,
  dir: "asc" | "desc",
): Prisma.EmployeeOrderByWithRelationInput {
  switch (sort) {
    case "document":
      return { document: dir };
    case "department":
      return { department: { name: dir } };
    case "position":
      return { position: { name: dir } };
    case "status":
      return { status: dir };
    default:
      return { name: dir };
  }
}

export type EmployeesPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: string;
  positionId?: string;
  sort: EmployeeSortField;
  dir: "asc" | "desc";
};

/** Busca paginada/filtrada/ordenada no servidor — substitui o `findMany` sem
 * `take`/`skip` que carregava todos os colaboradores da empresa de uma vez
 * (ver docs/performance.md). */
export async function getEmployeesPage(companyId: string, params: EmployeesPageParams) {
  const { page, pageSize, search, departmentId, positionId, sort, dir } = params;

  const where: Prisma.EmployeeWhereInput = {
    companyId,
    ...(departmentId ? { departmentId } : {}),
    ...(positionId ? { positionId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { document: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      include: employeeListInclude,
      orderBy: buildEmployeeOrderBy(sort, dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

  return { rows, total };
}

// ---------------------------------------------------------------------------
// Sprint SST 1.4F — serviço central de criação/edição/inativação/reativação,
// extraído do que antes vivia direto em app/api/employees/*.ts (só Portal
// Empresa) para ser compartilhado pelo Portal Consultoria SST também. Nenhum
// dos dois portais mantém sua própria cópia da regra — as APIs de cada
// portal só resolvem AUTORIZAÇÃO (permissão de RBAC ou vínculo SST) e
// chamam estas funções com o `companyId` JÁ autorizado pelo caller. Nenhuma
// função aqui aceita companyId/providerId/tenant vindo de um payload não
// confiável — sempre parâmetro explícito, resolvido pelo guard do chamador.
//
// Propriedade (Sprint SST 1.4F, §4): Employee pertence exclusivamente à
// Company. Nenhuma linha aqui grava um providerId como dono do colaborador
// — a rastreabilidade de "quem operou" (Portal Empresa vs. consultoria)
// vive só em AuditLog (actorType/providerId no ActorInput), nunca em uma
// coluna do próprio Employee.

const EMPLOYEE_DUPLICATE_DOCUMENT_MESSAGE = "Já existe um colaborador com este documento nesta empresa.";

function isDuplicateDocumentError(error: unknown): boolean {
  // Employee só tem UMA unique constraint (`@@unique([companyId, document])`)
  // — qualquer P2002 em create/update deste model é necessariamente essa
  // colisão, então não precisa inspecionar `error.meta.target` (cujo
  // formato varia entre o engine padrão e o driver adapter @prisma/adapter-pg
  // usado neste projeto).
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Diferença de campos entre o estado anterior e o novo — só NOMES de campo
 * (nunca o valor), para auditoria segura (§10/§17: nunca logar documento
 * completo nem qualquer outro dado do colaborador). */
type EmployeeComparableFields = {
  name: string;
  document: string;
  email?: string | null;
  phone?: string | null;
  registration?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  status: string;
};

function diffEmployeeFields(before: EmployeeComparableFields, after: EmployeeComparableFields): string[] {
  const fields = ["name", "document", "email", "phone", "registration", "departmentId", "positionId", "status"] as const;
  return fields.filter((field) => (before[field] ?? null) !== (after[field] ?? null));
}

export async function getEmployeeForCompany(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    include: employeeListInclude,
  });
  if (!employee) throw new NotFoundError("Colaborador não encontrado.");
  return employee;
}

export async function createEmployeeForCompany(
  companyId: string,
  input: EmployeeInput,
  actor: ActorInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      await validateEmployeeOrganizationReferences({
        companyId,
        departmentId: input.departmentId,
        positionId: input.positionId,
        tx,
      });

      const employee = await tx.employee.create({
        data: { ...input, companyId },
        include: employeeListInclude,
      });
      await logAudit(tx, {
        companyId,
        actorUserId: actor.id,
        actorName: actor.name,
        actorType: actor.actorType,
        providerId: actor.providerId,
        action: "employee.create",
        targetType: "Employee",
        targetId: employee.id,
        targetLabel: employee.name,
      });
      return employee;
    });
  } catch (error) {
    if (isDuplicateDocumentError(error)) {
      throw new ValidationError(EMPLOYEE_DUPLICATE_DOCUMENT_MESSAGE);
    }
    throw error;
  }
}

export async function updateEmployeeForCompany(
  companyId: string,
  employeeId: string,
  input: EmployeeInput,
  actor: ActorInput,
) {
  const existing = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!existing) throw new NotFoundError("Colaborador não encontrado.");

  const changedFields = diffEmployeeFields(existing, input);

  try {
    return await prisma.$transaction(async (tx) => {
      await validateEmployeeOrganizationReferences({
        companyId,
        departmentId: input.departmentId,
        positionId: input.positionId,
        tx,
      });

      const employee = await tx.employee.update({
        where: { id: employeeId },
        data: input,
        include: employeeListInclude,
      });
      if (changedFields.length > 0) {
        await logAudit(tx, {
          companyId,
          actorUserId: actor.id,
          actorName: actor.name,
          actorType: actor.actorType,
          providerId: actor.providerId,
          action: "employee.update",
          targetType: "Employee",
          targetId: employee.id,
          targetLabel: employee.name,
          metadata: { changedFields },
        });
      }
      return employee;
    });
  } catch (error) {
    if (isDuplicateDocumentError(error)) {
      throw new ValidationError(EMPLOYEE_DUPLICATE_DOCUMENT_MESSAGE);
    }
    throw error;
  }
}

/** Soft delete: marca INACTIVE, nunca remove a linha — preserva histórico
 * (custódias/treinamentos podem referenciar o colaborador). Idempotente:
 * chamar sobre um já INACTIVE só reconfirma o estado, sem auditoria
 * duplicada (mesmo espírito de markNotificationRead).
 *
 * Sprint SST 1.4F.1, §10 — audita como `employee.deactivate`, não mais
 * `employee.delete`: nenhuma linha é de fato apagada (confirmado — não há
 * NENHUM `prisma.employee.delete`/`deleteMany` em todo o código da
 * aplicação), então um nome de evento com "delete" era semanticamente
 * incorreto. `employee.delete` permanece no catálogo (`lib/audit.ts`) só
 * para não invalidar o tipo de linhas de auditoria já gravadas com esse
 * valor (nenhuma migração de dado histórico é feita). */
export async function deactivateEmployeeForCompany(companyId: string, employeeId: string, actor: ActorInput) {
  const existing = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: employeeListInclude });
  if (!existing) throw new NotFoundError("Colaborador não encontrado.");
  if (existing.status === "INACTIVE") {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.update({
      where: { id: employeeId },
      data: { status: "INACTIVE" },
      include: employeeListInclude,
    });
    // targetLabel só com o nome — nunca o documento (CPF), dado sensível.
    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "employee.deactivate",
      targetType: "Employee",
      targetId: employeeId,
      targetLabel: existing.name,
    });
    return employee;
  });
}

/** Reativa um colaborador previamente inativado — mesma operação que já era
 * possível via edição do campo `status` no Portal Empresa (nunca um
 * comportamento novo), só exposta aqui como ação própria para o Portal
 * Consultoria (§14 do spec: rota dedicada de reactivate). Idempotente. */
export async function reactivateEmployeeForCompany(companyId: string, employeeId: string, actor: ActorInput) {
  const existing = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: employeeListInclude });
  if (!existing) throw new NotFoundError("Colaborador não encontrado.");
  if (existing.status === "ACTIVE") {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.update({
      where: { id: employeeId },
      data: { status: "ACTIVE" },
      include: employeeListInclude,
    });
    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "employee.reactivate",
      targetType: "Employee",
      targetId: employeeId,
      targetLabel: existing.name,
    });
    return employee;
  });
}
