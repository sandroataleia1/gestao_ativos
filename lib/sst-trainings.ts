import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth-server";
import { NotFoundError } from "@/lib/api-errors";

// Regra de posse do Portal Consultoria sobre CompanyTraining/TrainingClass —
// ver docs/portal-consultoria.md ("regra de gestão"). Decisão arquitetural:
// a consultoria só opera (edita treinamento, cria/edita turma) o que ela
// mesma gerencia (managementMode EXTERNAL_PROVIDER + managedByProviderId ==
// provider da sessão) — nunca treinamentos internos nem de outro prestador,
// mesmo com accessLevel ADMINISTRATION/OPERATION no vínculo.

/**
 * Garante que o `CompanyTraining` pertence à empresa (`companyId`) e é
 * gerenciado pelo provider informado — lança NotFoundError se o
 * treinamento não existe/não é da empresa (mesmo padrão de
 * `assertCompanyTrainingBelongsToCompany`, lib/training-classes.ts) e
 * ForbiddenError se existe mas é gerenciado internamente ou por outro
 * prestador. Retorna o treinamento para reaproveitar sem nova query.
 */
export async function assertProviderManagesCompanyTraining(
  companyId: string,
  companyTrainingId: string,
  providerId: string,
) {
  const training = await prisma.companyTraining.findFirst({
    where: { id: companyTrainingId, companyId },
  });
  if (!training) throw new NotFoundError("Treinamento não encontrado.");

  if (training.managementMode !== "EXTERNAL_PROVIDER" || training.managedByProviderId !== providerId) {
    throw new ForbiddenError("Você só pode operar treinamentos gerenciados por esta consultoria.");
  }

  return training;
}

export type TrainingManagementLabel =
  | "MANAGED_BY_THIS_PROVIDER"
  | "MANAGED_INTERNALLY"
  | "MANAGED_BY_OTHER_PROVIDER"
  | "PROVIDER_WITHOUT_ACTIVE_LINK";

type TrainingWithManagement = {
  managementMode: "INTERNAL" | "EXTERNAL_PROVIDER";
  managedByProviderId: string | null;
  managedByProvider: { companyLinks: { status: string }[] } | null;
};

/**
 * Classifica a "gestão" de um treinamento para exibição — reaproveita o
 * mesmo dado já trazido por `managedByProviderSelect` (lib/trainings.ts,
 * `companyLinks` já filtrado por companyId), sem N+1: não checa
 * `provider.active` separadamente, mesmo critério já usado pelo badge
 * "Prestador sem autorização ativa" do Portal Empresa
 * (app/(app)/trainings/trainings-table.tsx) — só o status do vínculo.
 */
export function classifyTrainingManagementLabel(
  training: TrainingWithManagement,
  currentProviderId: string,
): TrainingManagementLabel {
  if (training.managementMode !== "EXTERNAL_PROVIDER") return "MANAGED_INTERNALLY";
  if (training.managedByProviderId === currentProviderId) return "MANAGED_BY_THIS_PROVIDER";

  const linkStatus = training.managedByProvider?.companyLinks[0]?.status;
  return linkStatus === "ACTIVE" ? "MANAGED_BY_OTHER_PROVIDER" : "PROVIDER_WITHOUT_ACTIVE_LINK";
}
