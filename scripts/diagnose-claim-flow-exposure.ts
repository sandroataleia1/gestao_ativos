import "dotenv/config";
import { prisma } from "../lib/prisma";
import { maskCnpjForLog } from "../lib/cnpj";

// Sprint SST 1.4C, §20/§21 — diagnóstico SOMENTE LEITURA de
// CompanyMembership potencialmente criadas pelo fluxo inseguro de
// app/api/register/route.ts entre o deploy do commit 42fc120 (que continha
// a concessão automática de ADMIN a partir do CNPJ) e a implantação da
// contenção desta sprint. Nunca apaga/altera nada — só relata para revisão
// manual. Nunca imprime CNPJ/e-mail completos.
//
// Uso: npx tsx scripts/diagnose-claim-flow-exposure.ts [--since=YYYY-MM-DDTHH:mm:ssZ]
//
// Sem --since, usa o timestamp do commit 42fc120 neste checkout local como
// aproximação (`git log -1 --format=%cI 42fc120`) — ajuste manualmente para
// o timestamp real de deploy em produção (ver checklist no relatório da
// sprint), que pode diferir do commit local.

const DEFAULT_SINCE = "2026-07-14T17:34:08-03:00"; // commit 42fc120 (ajustar para o deploy real em produção)

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1];
  const since = new Date(sinceArg ?? DEFAULT_SINCE);

  console.log("=".repeat(72));
  console.log("Diagnóstico de exposição — fluxo de registro inseguro (Sprint SST 1.4C)");
  console.log("=".repeat(72));
  console.log(`Desde: ${since.toISOString()}`);
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, "://***:***@")}`);
  console.log();

  // Toda CompanyMembership ACTIVE criada nesta janela — o fluxo antigo só
  // criava membership com status ACTIVE diretamente (nunca INVITED), então
  // isso já restringe bastante o universo (convites legítimos nascem
  // INVITED e só viram ACTIVE numa ação separada, com outro createdAt).
  const memberships = await prisma.companyMembership.findMany({
    where: { createdAt: { gte: since }, status: "ACTIVE" },
    include: {
      user: { select: { id: true, email: true, createdAt: true } },
      company: { select: { id: true, name: true, origin: true, controlStatus: true, documentNormalized: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`CompanyMembership ACTIVE criadas desde então: ${memberships.length}`);
  console.log();

  if (memberships.length === 0) {
    console.log("Nenhuma — nada para revisar manualmente.");
    await prisma.$disconnect();
    return;
  }

  let suspiciousCount = 0;

  for (const membership of memberships) {
    // Sinal de alta suspeita: a Company tinha origem SST_PROVIDER (pré-
    // cadastrada por uma consultoria) — antes desta sprint, reivindicar uma
    // dessas concedia ADMIN instantâneo sobre dados potencialmente reais
    // (colaboradores/treinamentos/documentos) sem NENHUMA comprovação.
    const isPreRegisteredClaim = membership.company.origin === "SST_PROVIDER";

    const claimStartedEvent = await prisma.auditLog.findFirst({
      where: {
        companyId: membership.companyId,
        action: "company.claim_started",
        createdAt: { gte: new Date(membership.createdAt.getTime() - 60_000), lte: new Date(membership.createdAt.getTime() + 60_000) },
      },
    });

    // Depois desta sprint, toda CompanyMembership legítima nasce de uma
    // CompanyClaimRequest APPROVED — sua ausência aqui, combinada com a
    // data, é evidência de que a linha veio do caminho antigo.
    const claimRequest = await prisma.companyClaimRequest.findUnique({
      where: { companyId_requesterUserId: { companyId: membership.companyId, requesterUserId: membership.userId } },
    });

    const suspicious = isPreRegisteredClaim || Boolean(claimStartedEvent) || !claimRequest;
    if (suspicious) suspiciousCount += 1;

    console.log(`${suspicious ? "[SUSPEITA] " : "[OK]       "}membership=${membership.id}`);
    console.log(`  companyId=${membership.company.id} nome="${membership.company.name}" origin=${membership.company.origin} controlStatus=${membership.company.controlStatus}`);
    if (membership.company.documentNormalized) {
      console.log(`  cnpj=${maskCnpjForLog(membership.company.documentNormalized)}`);
    }
    console.log(`  userId=${membership.user.id} email=${maskEmail(membership.user.email)}`);
    console.log(`  membership.createdAt=${membership.createdAt.toISOString()} user.createdAt=${membership.user.createdAt.toISOString()}`);
    console.log(`  claim_started AuditLog encontrado: ${Boolean(claimStartedEvent)}`);
    console.log(`  CompanyClaimRequest (pós-sprint) existente: ${claimRequest ? claimRequest.status : "NENHUMA"}`);
    console.log();
  }

  console.log("=".repeat(72));
  console.log(`Total: ${memberships.length} | Suspeitas para revisão manual: ${suspiciousCount}`);
  console.log("Nenhuma linha foi alterada ou removida — script somente-leitura.");
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
