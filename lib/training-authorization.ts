import type {
  SstProviderCompanyAccessLevel,
  SstProviderCompanyStatus,
  TrainingManagementMode,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Estado de gestão de um CompanyTraining — ponto único de leitura para
 * "quem gerencia isso e o que essa parte pode fazer". Elimina a lógica que
 * antes ficava espalhada entre `assertManagementModeValid`
 * (lib/trainings.ts) e `assertProviderCanManage` (lib/sst-providers.ts),
 * que faziam a mesma consulta a `SstProvider`/`SstProviderCompany` cada uma
 * à sua maneira.
 *
 * `providerCanOperate`/`companyCanOperate` são preparação para o futuro
 * Portal Consultoria (ver docs/training-architecture.md) — hoje não existe
 * sessão de prestador nenhuma, então `providerCanOperate` é sempre `false`
 * e `companyCanOperate` é sempre `true` (todo chamador já passou por
 * `requirePermission` antes de chegar aqui). Nenhuma rota decide acesso a
 * partir desses dois campos nesta sprint — são só o ponto de extensão para
 * quando o portal existir.
 */
export type TrainingAuthorization = {
  companyId: string;
  managementMode: TrainingManagementMode;
  managedByProviderId: string | null;
  providerActive: boolean | null;
  providerStatus: SstProviderCompanyStatus | null;
  providerAccessLevel: SstProviderCompanyAccessLevel | null;
  isManagedInternally: boolean;
  isManagedByProvider: boolean;
  providerCanOperate: boolean;
  companyCanOperate: boolean;
};

export async function resolveTrainingAuthorization(
  companyId: string,
  managementMode: TrainingManagementMode,
  managedByProviderId: string | null,
): Promise<TrainingAuthorization> {
  const isManagedInternally = managementMode === "INTERNAL";
  const isManagedByProvider = managementMode === "EXTERNAL_PROVIDER";

  let providerActive: boolean | null = null;
  let providerStatus: SstProviderCompanyStatus | null = null;
  let providerAccessLevel: SstProviderCompanyAccessLevel | null = null;

  if (isManagedByProvider && managedByProviderId) {
    const [provider, link] = await Promise.all([
      prisma.sstProvider.findUnique({
        where: { id: managedByProviderId },
        select: { active: true },
      }),
      prisma.sstProviderCompany.findFirst({
        where: { providerId: managedByProviderId, companyId },
        select: { status: true, accessLevel: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    providerActive = provider?.active ?? null;
    providerStatus = link?.status ?? null;
    providerAccessLevel = link?.accessLevel ?? null;
  }

  return {
    companyId,
    managementMode,
    managedByProviderId,
    providerActive,
    providerStatus,
    providerAccessLevel,
    isManagedInternally,
    isManagedByProvider,
    providerCanOperate: false,
    companyCanOperate: true,
  };
}
