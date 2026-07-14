import "dotenv/config";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/prisma";

// Contraparte de prisma/seed-sst-demo.ts — apaga SOMENTE as empresas de
// demonstração criadas por aquele script (identificadas pelo sufixo
// "(Demo SST)" no nome, único usado por essas 5 empresas) e tudo que
// pertence a elas. Nunca toca em "Empresa Demo", nem em nenhuma empresa
// real cadastrada pelos usuários. Não apaga o SstProvider nem os usuários
// de portal (sst@demo.com/sst-tech@demo.com/sst-viewer@demo.com) — só o
// vínculo SstProviderCompany com as empresas de demo, que caem junto com a
// empresa.
//
// Uso: npm run db:reset-sst-demo (roda este script e depois refaz o seed).

const DEMO_SUFFIX = "(Demo SST)";

export async function resetSstDemo() {
  const companies = await prisma.company.findMany({
    where: { name: { endsWith: DEMO_SUFFIX } },
    select: { id: true, name: true },
  });

  if (companies.length === 0) {
    console.log("Nenhuma empresa de demonstração do Portal Consultoria encontrada — nada para resetar.");
    return { removedCompanyNames: [] as string[] };
  }

  const companyIds = companies.map((c) => c.id);

  await prisma.$transaction([
    // AuditLog.companyId é FK obrigatória — qualquer ação de escrita
    // registrada durante o uso real da demonstração (ex.: cancelar uma
    // turma, criar um treinamento) grava uma linha aqui. Sem apagar isso
    // antes da Company, o reset falha com violação de FK assim que a
    // demonstração tiver sido usada de verdade (não só no primeiro seed
    // "limpo") — bug real encontrado na validação manual desta sprint.
    prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.trainingParticipant.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.trainingClass.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.companyTraining.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.employee.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.department.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.position.deleteMany({ where: { companyId: { in: companyIds } } }),
    // Sprint Comercial SST 1.4 (extensão) — uma empresa de demo UNCLAIMED
    // pode ter sido reivindicada de verdade durante uma demonstração ao
    // vivo (fluxo de registro público, ver app/api/register/route.ts), o
    // que provisiona RBAC/lookups/membership nela — algo que nenhuma outra
    // empresa de demo tinha antes. Sem limpar isso aqui, o reset falha com
    // violação de FK assim que uma reivindicação real tiver acontecido.
    prisma.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.userRole.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.role.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockBalance.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.assetMovement.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.assetUnit.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.asset.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.assetCategory.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.location.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.locationType.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.movementType.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.assetStatus.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.assetCondition.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.sstProviderCompany.deleteMany({ where: { companyId: { in: companyIds } } }),
    prisma.company.deleteMany({ where: { id: { in: companyIds } } }),
  ]);

  const removedCompanyNames = companies.map((c) => c.name);
  console.log(`Empresas de demonstração removidas: ${removedCompanyNames.join(", ")}`);
  console.log("Rode `npm run db:seed-sst-demo` em seguida (ou use `npm run db:reset-sst-demo`, que já faz os dois passos).");
  return { removedCompanyNames };
}

const isMainModule = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  resetSstDemo()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
