import "dotenv/config";
import { prisma } from "../lib/prisma";
import { maskCnpjForLog } from "../lib/cnpj";
import { validateExposureWindow } from "../lib/claim-exposure-timestamp";
import { classifyMembership, MEMBERSHIP_CLASSIFICATION_LABELS, type MembershipClassification } from "../lib/claim-exposure-classifier";
import { logPlatformAudit } from "../lib/platform-audit";

// Sprint SST 1.4C / 1.4C.1 / 1.4D.1 — diagnóstico SOMENTE LEITURA de
// CompanyMembership potencialmente criadas pelo fluxo inseguro de
// app/api/register/route.ts, ativo entre o deploy do commit 42fc120 (que
// continha a concessão automática de ADMIN a partir do CNPJ) e a
// implantação da contenção. Nunca apaga/altera nada — só relata para
// revisão manual. Nunca imprime CNPJ/e-mail completos.
//
// Sprint SST 1.4D.1, §2 — o contrato mudou de "só --since" (implicitamente
// até "agora") para uma JANELA completa e obrigatória: --since/
// CLAIM_EXPOSURE_START_AT (início) E --until/CLAIM_EXPOSURE_END_AT (fim).
// O plano de implantação anterior usava por engano o timestamp do NOVO
// deploy seguro como início — isso faria a janela analisada começar tarde
// demais, ignorando todo o período real de exposição entre o deploy do
// commit vulnerável e a correção. Agora:
//   - início = data/hora real (ou o limite mais antigo plausível e
//     conservador) em que 42fc120 entrou em produção;
//   - fim = data/hora em que o código seguro foi implantado, ou "agora" se
//     o diagnóstico rodar antes da correção.
//
// Exemplo:
//   CLAIM_EXPOSURE_START_AT="2026-07-10T14:00:00-03:00" \
//   CLAIM_EXPOSURE_END_AT="2026-07-16T09:30:00-03:00" \
//   npm run diagnose:claim-flow-exposure
//
// ou, equivalentemente:
//   npm run diagnose:claim-flow-exposure -- --since=2026-07-10T14:00:00-03:00 --until=2026-07-16T09:30:00-03:00
//
// Sem AMBOS os valores, o script ABORTA sem consultar o banco. Nunca usa o
// timestamp do commit Git, da migration, ou do novo deploy como substituto
// silencioso de nenhuma das duas pontas.

function printUsageAndExit(message: string): never {
  console.error(`ERRO: ${message}`);
  console.error();
  console.error("Este script exige a JANELA COMPLETA de exposição (início E fim) — nunca");
  console.error("assume um valor default para nenhuma das duas pontas (um valor presumido");
  console.error("errado produziria falso negativo: memberships suspeitas fora da janela");
  console.error("verificada não apareceriam).");
  console.error();
  console.error("Uso:");
  console.error(
    '  CLAIM_EXPOSURE_START_AT="2026-07-10T14:00:00-03:00" CLAIM_EXPOSURE_END_AT="2026-07-16T09:30:00-03:00" npm run diagnose:claim-flow-exposure',
  );
  console.error(
    "  npm run diagnose:claim-flow-exposure -- --since=2026-07-10T14:00:00-03:00 --until=2026-07-16T09:30:00-03:00",
  );
  console.error();
  console.error("Ambos os timestamps devem ser ISO 8601 COM timezone explícita (Z ou");
  console.error("+/-HH:mm). O início deve ser o momento REAL (ou o limite mais antigo");
  console.error("plausível e conservador) em que o commit vulnerável 42fc120 entrou em");
  console.error("produção — NUNCA o timestamp do novo deploy seguro, do commit Git local, ou");
  console.error("da migration. Se o horário exato do deploy antigo for desconhecido, consulte");
  console.error("logs do PM2/systemd/CI-CD, histórico de shell, Git reflog do servidor,");
  console.error("observabilidade ou registro operacional, e use o limite mais antigo");
  console.error("plausível (nunca uma data mais recente só para reduzir o volume da análise).");
  process.exit(1);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1];
  const untilArg = process.argv.find((a) => a.startsWith("--until="))?.split("=")[1];
  const rawSince = sinceArg ?? process.env.CLAIM_EXPOSURE_START_AT;
  const rawUntil = untilArg ?? process.env.CLAIM_EXPOSURE_END_AT;

  const validation = validateExposureWindow(rawSince, rawUntil);
  if (!validation.ok) {
    printUsageAndExit(validation.error);
  }
  const { since, until } = validation;

  console.log("=".repeat(78));
  console.log("Diagnóstico de exposição — fluxo de registro inseguro (commit 42fc120)");
  console.log("=".repeat(78));
  console.log(`Janela analisada: ${since.toISOString()}  até  ${until.toISOString()}`);
  console.log(`Banco: ${process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, "://***:***@")}`);
  console.log("Modo: SOMENTE LEITURA — nenhuma escrita será feita, nenhuma membership é revogada.");
  console.log("=".repeat(78));
  console.log();

  // Sprint SST 1.4D.1, §17 — persiste que este diagnóstico foi executado
  // (fonte histórica: quando/por quem a janela foi analisada). Nunca inclui
  // CNPJ/e-mail nos metadados — só a janela (datas) e a contagem de linhas.
  await logPlatformAudit({
    action: "platform_admin.exposure_diagnostic_executed",
    severity: "INFO",
    source: "CLI",
    metadata: { since: since.toISOString(), until: until.toISOString() },
  }).catch(() => {
    // Nunca bloqueia o diagnóstico (somente-leitura) por falha ao persistir
    // o próprio registro de auditoria — best-effort, mesmo padrão de
    // logAudit() em pontos não-transacionais deste projeto.
  });

  // Busca TODAS as memberships ACTIVE (não só as da janela) — precisamos do
  // universo completo para classificar corretamente "anterior à exposição"
  // e "posterior à correção" (§3), nunca confundindo isso com "dentro da
  // janela mas não suspeita".
  const allMemberships = await prisma.companyMembership.findMany({
    where: { status: "ACTIVE" },
    include: {
      user: { select: { id: true, email: true, createdAt: true } },
      company: { select: { id: true, name: true, origin: true, controlStatus: true, documentNormalized: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const counts: Record<MembershipClassification, number> = {
    SUSPICIOUS_INSECURE_FLOW: 0,
    LEGITIMATE_INVITE: 0,
    LEGITIMATE_CLAIM_APPROVED: 0,
    SEED_OR_DEMO: 0,
    BEFORE_EXPOSURE: 0,
    AFTER_FIX: 0,
    INCONCLUSIVE_REVIEW_MANUALLY: 0,
  };

  const manualReviewEntries: string[] = [];

  for (const membership of allMemberships) {
    // Fora da janela — classifica só pela data, sem consultas extras (nunca
    // reclassifica algo anterior à exposição/posterior à correção como
    // suspeito só porque o padrão coincidiria por acaso).
    if (membership.createdAt.getTime() < since.getTime() || membership.createdAt.getTime() > until.getTime()) {
      const classification = classifyMembership({
        membershipCreatedAt: membership.createdAt,
        windowSince: since,
        windowUntil: until,
        companyName: membership.company.name,
        companyOrigin: membership.company.origin,
        invitedByUserId: membership.invitedByUserId,
        hasApprovedClaim: false,
        hasClaimStartedAuditEvent: false,
        userCreatedAt: membership.user.createdAt,
      });
      counts[classification] += 1;
      continue;
    }

    // Dentro da janela — sinais adicionais (1 consulta extra cada, aceitável:
    // só para o subconjunto realmente dentro da janela analisada).
    const claimStartedEvent = await prisma.auditLog.findFirst({
      where: {
        companyId: membership.companyId,
        action: "company.claim_started",
        createdAt: { gte: new Date(membership.createdAt.getTime() - 60_000), lte: new Date(membership.createdAt.getTime() + 60_000) },
      },
    });
    const claimRequest = await prisma.companyClaimRequest.findUnique({
      where: { companyId_requesterUserId: { companyId: membership.companyId, requesterUserId: membership.userId } },
    });
    const hasApprovedClaim = claimRequest?.status === "APPROVED";

    const classification = classifyMembership({
      membershipCreatedAt: membership.createdAt,
      windowSince: since,
      windowUntil: until,
      companyName: membership.company.name,
      companyOrigin: membership.company.origin,
      invitedByUserId: membership.invitedByUserId,
      hasApprovedClaim,
      hasClaimStartedAuditEvent: Boolean(claimStartedEvent),
      userCreatedAt: membership.user.createdAt,
    });
    counts[classification] += 1;

    if (classification === "SUSPICIOUS_INSECURE_FLOW" || classification === "INCONCLUSIVE_REVIEW_MANUALLY") {
      const label = classification === "SUSPICIOUS_INSECURE_FLOW" ? "[SUSPEITA]  " : "[REVISAR]   ";
      const lines = [
        `${label}membership=${membership.id}`,
        `  companyId=${membership.company.id} nome="${membership.company.name}" origin=${membership.company.origin} controlStatus=${membership.company.controlStatus}`,
        membership.company.documentNormalized ? `  cnpj=${maskCnpjForLog(membership.company.documentNormalized)}` : undefined,
        `  userId=${membership.user.id} email=${maskEmail(membership.user.email)}`,
        `  membership.createdAt=${membership.createdAt.toISOString()} user.createdAt=${membership.user.createdAt.toISOString()}`,
        `  claim_started AuditLog encontrado: ${Boolean(claimStartedEvent)}`,
        `  CompanyClaimRequest existente: ${claimRequest ? claimRequest.status : "NENHUMA"}`,
        "",
      ].filter((l): l is string => l !== undefined);
      manualReviewEntries.push(lines.join("\n"));
    }
  }

  console.log(`Total de CompanyMembership ACTIVE no sistema: ${allMemberships.length}`);
  console.log();
  console.log("Contagens agregadas (todas as categorias — §3):");
  for (const key of Object.keys(counts) as MembershipClassification[]) {
    console.log(`  ${MEMBERSHIP_CLASSIFICATION_LABELS[key].padEnd(42, " ")} ${counts[key]}`);
  }
  console.log();

  if (manualReviewEntries.length === 0) {
    console.log("Nenhum registro suspeito ou inconclusivo dentro da janela — nada para revisão manual.");
  } else {
    console.log("=".repeat(78));
    console.log(`REGISTROS PARA REVISÃO MANUAL (suspeitos + inconclusivos): ${manualReviewEntries.length}`);
    console.log("=".repeat(78));
    for (const entry of manualReviewEntries) {
      console.log(entry);
    }
  }

  console.log("=".repeat(78));
  console.log("Nenhuma linha foi alterada ou removida — script somente-leitura.");
  console.log("Nenhuma CompanyMembership é revogada ou corrigida automaticamente por este script.");
  console.log("=".repeat(78));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
