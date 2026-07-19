import "dotenv/config";
import { prisma } from "@/lib/prisma";

const DEMO_COMPANY_NAME = "Empresa Demo";

/**
 * Reseta os dados de negócio acumulados pela empresa demo durante testes,
 * para dar um ponto de partida limpo de homologação. Nunca toca em
 * estrutura/migrations, nunca apaga a Company nem RBAC (Role/Permission/
 * RolePermission/UserRole) — só o que o uso diário acumula (colaboradores,
 * ativos, certificações, custódias, documentos/assinaturas/fotos, estoque,
 * localizações, tipos de movimentação, treinamentos/turmas/participantes).
 * Escopado por `companyId`: nunca
 * afeta nenhuma outra empresa que exista no banco (ex.: criadas via
 * /register durante testes). Sempre seguido de `npm run db:seed`
 * (idempotente) — ver `npm run db:reset-demo` e docs/homologation.md.
 */
async function resetDemoData() {
  const company = await prisma.company.findFirst({ where: { name: DEMO_COMPANY_NAME } });
  if (!company) {
    console.log(`Nenhuma empresa "${DEMO_COMPANY_NAME}" encontrada — nada para resetar.`);
    return;
  }

  const companyId = company.id;

  await prisma.$transaction([
    prisma.custodySignature.deleteMany({ where: { companyId } }),
    prisma.custodySignatureRequest.deleteMany({ where: { companyId } }),
    prisma.custodyPhoto.deleteMany({ where: { companyId } }),
    prisma.custodyDocument.deleteMany({ where: { companyId } }),
    prisma.assetMovement.deleteMany({ where: { companyId } }),
    prisma.stockMovement.deleteMany({ where: { companyId } }),
    prisma.stockBalance.deleteMany({ where: { companyId } }),
    // AssetUnit.currentCustodyId aponta para AssetCustody (1-1) — zera o
    // ponteiro antes de apagar as custódias para não violar a FK.
    prisma.assetUnit.updateMany({ where: { companyId }, data: { currentCustodyId: null } }),
    prisma.assetCustody.deleteMany({ where: { companyId } }),
    prisma.assetUnit.deleteMany({ where: { companyId } }),
    prisma.assetCertification.deleteMany({ where: { companyId } }),
    prisma.asset.deleteMany({ where: { companyId } }),
    prisma.location.deleteMany({ where: { companyId } }),
    prisma.locationType.deleteMany({ where: { companyId } }),
    prisma.movementType.deleteMany({ where: { companyId } }),
    prisma.assetStatus.deleteMany({ where: { companyId } }),
    prisma.assetCondition.deleteMany({ where: { companyId } }),
    prisma.assetCategory.deleteMany({ where: { companyId } }),
    prisma.supplier.deleteMany({ where: { companyId } }),
    prisma.manufacturer.deleteMany({ where: { companyId } }),
    // Cadeia de treinamentos (Sprint SST 1.4G/1.4H, adicionada depois deste
    // script) — TrainingParticipant/TrainingClass* referenciam Employee
    // transitivamente, então precisam ser limpos antes do employee.deleteMany
    // abaixo. TrainingTemplate/SstProvider ficam de fora de propósito: são
    // catálogos globais, não dados da empresa demo.
    prisma.trainingClassSignature.deleteMany({ where: { companyId } }),
    prisma.trainingClassDocument.deleteMany({ where: { companyId } }),
    prisma.trainingParticipant.deleteMany({ where: { companyId } }),
    prisma.trainingClass.deleteMany({ where: { companyId } }),
    prisma.companyTraining.deleteMany({ where: { companyId } }),
    prisma.employee.deleteMany({ where: { companyId } }),
    prisma.position.deleteMany({ where: { companyId } }),
    prisma.department.deleteMany({ where: { companyId } }),
  ]);

  console.log(`Dados de negócio da empresa "${DEMO_COMPANY_NAME}" foram resetados.`);
  console.log("Rode `npm run db:seed` em seguida (ou use `npm run db:reset-demo`, que já faz os dois passos).");
}

resetDemoData()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
