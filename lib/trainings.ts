import type { Prisma, TrainingTemplate } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/api-errors";
import { logAudit, type ActorInput } from "@/lib/audit";
import { assertProviderCanManage } from "@/lib/sst-providers";
import type { CompanyTrainingInput } from "@/lib/validations/training";

/**
 * Inclui o prestador (quando houver) e o vínculo dessa MESMA empresa com
 * ele — `companyLinks` sempre filtrado por `companyId` (crítico: sem esse
 * filtro vazaria vínculos de outras empresas do mesmo SstProvider global,
 * já que SstProvider não tem companyId próprio). Usado para o badge
 * "Prestador sem autorização ativa" (ver trainings-table.tsx) sem N+1 —
 * uma única query, mesmo para a listagem inteira.
 */
export function managedByProviderSelect(companyId: string) {
  return {
    managedByProvider: {
      select: {
        id: true,
        name: true,
        companyLinks: { where: { companyId }, select: { status: true } },
      },
    },
  } as const;
}

export const TRAINING_SORT_FIELDS = ["title", "category", "trainingType", "mandatory", "active"] as const;
export type TrainingSortField = (typeof TRAINING_SORT_FIELDS)[number];

function buildTrainingOrderBy(
  sort: TrainingSortField,
  dir: "asc" | "desc",
): Prisma.CompanyTrainingOrderByWithRelationInput {
  switch (sort) {
    case "category":
      return { category: dir };
    case "trainingType":
      return { trainingType: dir };
    case "mandatory":
      return { mandatory: dir };
    case "active":
      return { active: dir };
    default:
      return { title: dir };
  }
}

export type CompanyTrainingsPageParams = {
  page: number;
  pageSize: number;
  search?: string;
  trainingType?: "LEGAL" | "CORPORATE";
  mandatory?: boolean;
  active?: boolean;
  sort: TrainingSortField;
  dir: "asc" | "desc";
};

/** Busca paginada/filtrada/ordenada no servidor — mesmo padrão de
 * getEmployeesPage (lib/employees.ts). Sem filtro de `active` por padrão
 * (mostra tudo, badge "Inativo" na tabela) — mesmo comportamento de
 * assets-table.tsx/employees-table.tsx. */
export async function getCompanyTrainingsPage(companyId: string, params: CompanyTrainingsPageParams) {
  const { page, pageSize, search, trainingType, mandatory, active, sort, dir } = params;

  const where: Prisma.CompanyTrainingWhereInput = {
    companyId,
    ...(trainingType ? { trainingType } : {}),
    ...(mandatory !== undefined ? { mandatory } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { category: { contains: search, mode: "insensitive" as const } },
            { nrReference: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.companyTraining.findMany({
      where,
      include: managedByProviderSelect(companyId),
      orderBy: buildTrainingOrderBy(sort, dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.companyTraining.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Busca o TrainingTemplate escolhido para servir de base a um novo
 * CompanyTraining. Global (sem companyId no where) — o catálogo é da
 * plataforma, não da empresa. Lança NotFoundError se o id não existir ou o
 * template estiver inativo (não faz sentido nascer um treinamento novo a
 * partir de um modelo desativado).
 */
export async function resolveTemplateForCreate(
  trainingTemplateId: string | undefined,
): Promise<TrainingTemplate | null> {
  if (!trainingTemplateId) return null;

  const template = await prisma.trainingTemplate.findFirst({
    where: { id: trainingTemplateId, active: true },
  });
  if (!template) throw new NotFoundError("Modelo de treinamento não encontrado.");

  return template;
}

/**
 * Monta o `data` de criação do CompanyTraining. Quando `trainingTemplateId`
 * é informado, os campos do template SEMPRE prevalecem sobre o que o client
 * mandou no mesmo payload — o client só escolhe qual modelo usar; o servidor
 * copia os valores reais na hora, evitando que um payload desatualizado ou
 * adulterado divirja do modelo selecionado. Sem template, usa os campos do
 * `input` normalmente (fluxo "personalizado").
 */
export function buildCompanyTrainingCreateData(
  companyId: string,
  input: CompanyTrainingInput,
  template: TrainingTemplate | null,
): Prisma.CompanyTrainingUncheckedCreateInput {
  if (template) {
    return {
      companyId,
      trainingTemplateId: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      trainingType: template.trainingType,
      nrReference: template.nrReference,
      validityMonths: template.defaultValidityMonths,
      workloadHours: template.defaultWorkloadHours,
      requiresCertificate: template.requiresCertificate,
      requiresAttendanceList: template.requiresAttendanceList,
      requiresSignature: template.requiresSignature,
      requiresExam: template.requiresExam,
      minimumPassingGrade: template.minimumPassingGrade,
      instructorType: template.defaultInstructorType,
      mandatory: input.mandatory,
      active: input.active,
    };
  }

  return {
    companyId,
    title: input.title,
    description: input.description,
    category: input.category,
    trainingType: input.trainingType,
    nrReference: input.nrReference,
    validityMonths: input.validityMonths,
    workloadHours: input.workloadHours,
    requiresCertificate: input.requiresCertificate,
    requiresAttendanceList: input.requiresAttendanceList,
    requiresSignature: input.requiresSignature,
    requiresExam: input.requiresExam,
    minimumPassingGrade: input.minimumPassingGrade,
    instructorType: input.instructorType,
    mandatory: input.mandatory,
    active: input.active,
  };
}

/** `data` de atualização do CompanyTraining — nunca re-copia de um template,
 * mesmo que `trainingTemplateId` venha no payload (é imutável após a
 * criação): editar é sempre independente do modelo de origem. */
export function buildCompanyTrainingUpdateData(
  input: CompanyTrainingInput,
): Prisma.CompanyTrainingUncheckedUpdateInput {
  return {
    title: input.title,
    description: input.description,
    category: input.category,
    trainingType: input.trainingType,
    nrReference: input.nrReference,
    validityMonths: input.validityMonths,
    workloadHours: input.workloadHours,
    requiresCertificate: input.requiresCertificate,
    requiresAttendanceList: input.requiresAttendanceList,
    requiresSignature: input.requiresSignature,
    requiresExam: input.requiresExam,
    minimumPassingGrade: input.minimumPassingGrade,
    instructorType: input.instructorType,
    mandatory: input.mandatory,
    active: input.active,
  };
}

/**
 * Valida `managementMode`/`managedByProviderId` e devolve os valores
 * prontos para entrar no `data` de create/update do CompanyTraining — nunca
 * confia no que o client manda: em INTERNAL, força managedByProviderId a
 * null no servidor; em EXTERNAL_PROVIDER, delega a
 * assertProviderCanManage (lib/sst-providers.ts) para conferir que o
 * provider existe/está ativo, tem vínculo ACTIVE com a empresa e
 * accessLevel OPERATION/ADMINISTRATION. Ver docs/sst-providers.md.
 */
export async function assertManagementModeValid(
  companyId: string,
  managementMode: CompanyTrainingInput["managementMode"],
  managedByProviderId: string | undefined,
): Promise<Pick<Prisma.CompanyTrainingUncheckedCreateInput, "managementMode" | "managedByProviderId">> {
  if (managementMode === "INTERNAL") {
    return { managementMode: "INTERNAL", managedByProviderId: null };
  }

  if (!managedByProviderId) {
    throw new ValidationError("Selecione o prestador SST responsável.");
  }
  await assertProviderCanManage(companyId, managedByProviderId);

  return { managementMode: "EXTERNAL_PROVIDER", managedByProviderId };
}

/** Cria um CompanyTraining — reaproveita resolveTemplateForCreate/
 * buildCompanyTrainingCreateData/assertManagementModeValid (inalteradas) e
 * embrulha em transação + `training.create` no audit trail. */
export async function createCompanyTraining(companyId: string, actor: ActorInput, input: CompanyTrainingInput) {
  const template = await resolveTemplateForCreate(input.trainingTemplateId);
  const data = buildCompanyTrainingCreateData(companyId, input, template);
  const managementFields = await assertManagementModeValid(companyId, input.managementMode, input.managedByProviderId);

  return prisma.$transaction(async (tx) => {
    const training = await tx.companyTraining.create({
      data: { ...data, ...managementFields },
      include: managedByProviderSelect(companyId),
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training.create",
      targetType: "CompanyTraining",
      targetId: training.id,
      targetLabel: training.title,
      metadata: { managementMode: training.managementMode, trainingType: training.trainingType },
    });

    return training;
  });
}

/** Atualiza um CompanyTraining já existente — mesma validação de
 * `managementMode` do create, nunca re-copia de template. Registra
 * `training.update`. */
export async function updateCompanyTraining(
  companyId: string,
  actor: ActorInput,
  id: string,
  input: CompanyTrainingInput,
) {
  const managementFields = await assertManagementModeValid(companyId, input.managementMode, input.managedByProviderId);

  return prisma.$transaction(async (tx) => {
    const training = await tx.companyTraining.update({
      where: { id },
      data: { ...buildCompanyTrainingUpdateData(input), ...managementFields },
      include: managedByProviderSelect(companyId),
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training.update",
      targetType: "CompanyTraining",
      targetId: training.id,
      targetLabel: training.title,
      metadata: { managementMode: training.managementMode, active: training.active },
    });

    return training;
  });
}

/** Soft delete (active: false) — nunca apaga a linha. Registra
 * `training.deactivate`. */
export async function deactivateCompanyTraining(companyId: string, actor: ActorInput, id: string) {
  return prisma.$transaction(async (tx) => {
    const training = await tx.companyTraining.update({
      where: { id },
      data: { active: false },
    });

    await logAudit(tx, {
      companyId,
      actorUserId: actor.id,
      actorName: actor.name,
      actorType: actor.actorType,
      providerId: actor.providerId,
      action: "training.deactivate",
      targetType: "CompanyTraining",
      targetId: training.id,
      targetLabel: training.title,
    });

    return training;
  });
}
