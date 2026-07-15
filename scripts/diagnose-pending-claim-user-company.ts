import "dotenv/config";
import { prisma } from "../lib/prisma";
import { isPrematureAssociation } from "../lib/premature-association";

// Sprint SST 1.4C.1, §6 — diagnóstico SOMENTE LEITURA de "associação legada
// prematura": usuários cujo `User.companyId` aponta para uma Company para a
// qual eles têm uma CompanyClaimRequest, mas NÃO têm CompanyMembership
// ACTIVE — ou seja, `companyId` foi preenchido (pelo fluxo da Sprint SST
// 1.4C, antes desta correção) sem que o usuário de fato administre aquela
// empresa. Nunca altera nada; só relata para revisão manual.
//
// Uso: npm run diagnose:pending-claim-user-company

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  console.log("=".repeat(72));
  console.log("Diagnóstico de associação legada prematura (Sprint SST 1.4C.1)");
  console.log("=".repeat(72));
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, "://***:***@")}`);
  console.log();

  const usersWithClaims = await prisma.user.findMany({
    where: { companyClaimRequestsMade: { some: {} } },
    select: {
      id: true,
      email: true,
      companyId: true,
      createdAt: true,
      companyClaimRequestsMade: {
        select: { id: true, companyId: true, status: true, requestedAt: true },
        orderBy: { requestedAt: "desc" },
      },
      companyMemberships: {
        select: { companyId: true, status: true },
      },
    },
  });

  console.log(`Usuários com pelo menos uma CompanyClaimRequest: ${usersWithClaims.length}`);
  console.log();

  let prematureCount = 0;
  let withoutActiveMembershipCount = 0;

  for (const user of usersWithClaims) {
    const activeMembershipCompanyIds = new Set(
      user.companyMemberships.filter((m) => m.status === "ACTIVE").map((m) => m.companyId),
    );
    const hasAnyActiveMembership = activeMembershipCompanyIds.size > 0;
    if (!hasAnyActiveMembership) withoutActiveMembershipCount += 1;

    // Associação prematura: User.companyId preenchido para uma empresa que
    // o usuário reivindicou, mas sem CompanyMembership ACTIVE para ela.
    const isPremature = isPrematureAssociation({
      userCompanyId: user.companyId,
      claimCompanyIds: user.companyClaimRequestsMade.map((c) => c.companyId),
      activeMembershipCompanyIds: [...activeMembershipCompanyIds],
    });

    if (isPremature) prematureCount += 1;

    console.log(`${isPremature ? "[PREMATURA]" : "[OK]       "} userId=${user.id} email=${maskEmail(user.email)}`);
    console.log(`  User.companyId=${user.companyId ?? "null"}`);
    console.log(`  CompanyMembership ACTIVE: ${hasAnyActiveMembership ? [...activeMembershipCompanyIds].join(", ") : "NENHUMA"}`);
    for (const claim of user.companyClaimRequestsMade) {
      console.log(`  claim=${claim.id} companyId=${claim.companyId} status=${claim.status} requestedAt=${claim.requestedAt.toISOString()}`);
    }
    console.log();
  }

  console.log("=".repeat(72));
  console.log(`Total com claim: ${usersWithClaims.length}`);
  console.log(`Sem CompanyMembership ACTIVE nenhuma: ${withoutActiveMembershipCount}`);
  console.log(`Associação prematura (User.companyId sem membership correspondente): ${prematureCount}`);
  console.log();
  console.log("Nenhum dado foi alterado — diagnóstico somente-leitura.");
  if (prematureCount > 0) {
    console.log();
    console.log("Para corrigir os casos [PREMATURA] em desenvolvimento, use um script de");
    console.log("saneamento dedicado que exija confirmação explícita e atue SOMENTE em");
    console.log("usuários sem nenhuma CompanyMembership (nunca aplicar em produção");
    console.log("automaticamente) — ver relatório da Sprint SST 1.4C.1.");
  }
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
