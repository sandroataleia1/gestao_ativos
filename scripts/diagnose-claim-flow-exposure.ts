import "dotenv/config";
import { prisma } from "../lib/prisma";
import { maskCnpjForLog } from "../lib/cnpj";
import { validateSinceTimestamp } from "../lib/claim-exposure-timestamp";

// Sprint SST 1.4C / 1.4C.1, §20-21 / §10 — diagnóstico SOMENTE LEITURA de
// CompanyMembership potencialmente criadas pelo fluxo inseguro de
// app/api/register/route.ts entre o deploy do commit 42fc120 (que continha
// a concessão automática de ADMIN a partir do CNPJ) e a implantação da
// contenção. Nunca apaga/altera nada — só relata para revisão manual.
// Nunca imprime CNPJ/e-mail completos.
//
// Sprint SST 1.4C.1, §10 — NUNCA usa um timestamp default silencioso (um
// valor presumido errado produziria falso negativo: memberships suspeitas
// fora da janela verificada simplesmente não apareceriam). O timestamp de
// início é sempre exigido explicitamente:
//
//   CLAIM_EXPOSURE_START_AT="2026-07-14T20:34:08Z" npm run diagnose:claim-flow-exposure
//
// ou, equivalentemente:
//
//   npm run diagnose:claim-flow-exposure -- --since=2026-07-14T20:34:08Z
//
// Sem um dos dois, o script ABORTA sem consultar o banco.

function printUsageAndExit(message: string): never {
  console.error(`ERRO: ${message}`);
  console.error();
  console.error("Este script exige o timestamp exato de início da janela de exposição —");
  console.error("nunca assume um valor default (um valor presumido errado produziria falso");
  console.error("negativo: memberships suspeitas fora da janela verificada não apareceriam).");
  console.error();
  console.error("Uso:");
  console.error('  CLAIM_EXPOSURE_START_AT="2026-07-14T20:34:08Z" npm run diagnose:claim-flow-exposure');
  console.error("  npm run diagnose:claim-flow-exposure -- --since=2026-07-14T20:34:08Z");
  console.error();
  console.error("O timestamp deve ser ISO 8601 COM timezone explícita (Z ou +/-HH:mm) — o");
  console.error("timestamp real de deploy do commit 42fc120 em produção, não o timestamp do");
  console.error("commit local (que pode ser diferente do momento em que o deploy realmente");
  console.error("aconteceu no servidor).");
  process.exit(1);
}

function parseAndValidateSince(raw: string): Date {
  const result = validateSinceTimestamp(raw);
  if (!result.ok) {
    printUsageAndExit(result.error);
  }
  return result.value;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

type Classification =
  | "SUSPICIOUS_INSECURE_FLOW"
  | "LEGITIMATE_INVITE"
  | "INCONCLUSIVE_REVIEW_MANUALLY";

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1];
  const sinceEnv = process.env.CLAIM_EXPOSURE_START_AT;
  const rawSince = sinceArg ?? sinceEnv;

  if (!rawSince) {
    printUsageAndExit("Nenhum timestamp de início informado (nem --since=, nem CLAIM_EXPOSURE_START_AT).");
  }
  const since = parseAndValidateSince(rawSince);

  console.log("=".repeat(72));
  console.log("Diagnóstico de exposição — fluxo de registro inseguro (Sprint SST 1.4C)");
  console.log("=".repeat(72));
  console.log(`Desde: ${since.toISOString()}`);
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, "://***:***@")}`);
  console.log("Modo: SOMENTE LEITURA — nenhuma escrita será feita.");
  console.log();

  // Toda CompanyMembership ACTIVE criada nesta janela — o fluxo antigo só
  // criava membership com status ACTIVE diretamente (nunca INVITED), então
  // isso já restringe bastante o universo. Convites legítimos nascem
  // INVITED (invitedByUserId preenchido) e só viram ACTIVE numa ação
  // separada — capturados aqui também, mas classificados à parte abaixo.
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

  const counts: Record<Classification, number> = {
    SUSPICIOUS_INSECURE_FLOW: 0,
    LEGITIMATE_INVITE: 0,
    INCONCLUSIVE_REVIEW_MANUALLY: 0,
  };

  for (const membership of memberships) {
    // Sinal forte de legitimidade: membership com convite explícito nunca
    // passa pelo fluxo público de registro (que nunca preenche
    // invitedByUserId) — nem o antigo (inseguro) nem o atual.
    if (membership.invitedByUserId) {
      counts.LEGITIMATE_INVITE += 1;
      console.log(`[LEGÍTIMA - CONVITE] membership=${membership.id}`);
      console.log(`  companyId=${membership.company.id} nome="${membership.company.name}"`);
      console.log(`  userId=${membership.user.id} email=${maskEmail(membership.user.email)}`);
      console.log(`  invitedByUserId=${membership.invitedByUserId} membership.createdAt=${membership.createdAt.toISOString()}`);
      console.log();
      continue;
    }

    // Sinal de alta suspeita: a Company tinha origem SST_PROVIDER (pré-
    // cadastrada por uma consultoria) — antes da correção, reivindicar uma
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

    // Depois da correção, toda CompanyMembership legítima nasce de uma
    // CompanyClaimRequest APPROVED — sua ausência aqui, combinada com os
    // outros sinais, é evidência de que a linha veio do caminho antigo.
    const claimRequest = await prisma.companyClaimRequest.findUnique({
      where: { companyId_requesterUserId: { companyId: membership.companyId, requesterUserId: membership.userId } },
    });
    const hasApprovedClaim = claimRequest?.status === "APPROVED";

    // Conta e usuário criados praticamente juntos (mesmo padrão do
    // self-registration: cadastro cria User + já teria criado a
    // membership no fluxo antigo) — sinal adicional, nunca decisivo
    // sozinho.
    const userCreatedNearMembership = Math.abs(membership.user.createdAt.getTime() - membership.createdAt.getTime()) < 60_000;

    let classification: Classification;
    if (isPreRegisteredClaim || Boolean(claimStartedEvent) || (!claimRequest && userCreatedNearMembership)) {
      classification = "SUSPICIOUS_INSECURE_FLOW";
    } else if (hasApprovedClaim) {
      // CompanyClaimRequest APPROVED existente = passou pelo fluxo NOVO e
      // seguro (approveCompanyClaimRequest) — legítima mesmo sem convite
      // (ex.: reivindicação aprovada por um futuro Super Admin Lite).
      classification = "LEGITIMATE_INVITE";
    } else {
      classification = "INCONCLUSIVE_REVIEW_MANUALLY";
    }
    counts[classification] += 1;

    const label =
      classification === "SUSPICIOUS_INSECURE_FLOW"
        ? "[SUSPEITA]  "
        : classification === "LEGITIMATE_INVITE"
          ? "[LEGÍTIMA]  "
          : "[REVISAR]   ";

    console.log(`${label}membership=${membership.id}`);
    console.log(`  companyId=${membership.company.id} nome="${membership.company.name}" origin=${membership.company.origin} controlStatus=${membership.company.controlStatus}`);
    if (membership.company.documentNormalized) {
      console.log(`  cnpj=${maskCnpjForLog(membership.company.documentNormalized)}`);
    }
    console.log(`  userId=${membership.user.id} email=${maskEmail(membership.user.email)}`);
    console.log(`  membership.createdAt=${membership.createdAt.toISOString()} user.createdAt=${membership.user.createdAt.toISOString()}`);
    console.log(`  claim_started AuditLog encontrado: ${Boolean(claimStartedEvent)}`);
    console.log(`  CompanyClaimRequest existente: ${claimRequest ? claimRequest.status : "NENHUMA"}`);
    console.log();
  }

  console.log("=".repeat(72));
  console.log(`Total: ${memberships.length}`);
  console.log(`  Possivelmente criadas pelo fluxo inseguro: ${counts.SUSPICIOUS_INSECURE_FLOW}`);
  console.log(`  Legítimas (convite explícito ou claim aprovada): ${counts.LEGITIMATE_INVITE}`);
  console.log(`  Inconclusivas — revisar manualmente: ${counts.INCONCLUSIVE_REVIEW_MANUALLY}`);
  console.log();
  console.log("Nenhuma linha foi alterada ou removida — script somente-leitura.");
  console.log("Nenhuma CompanyMembership é revogada automaticamente por este script.");
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
