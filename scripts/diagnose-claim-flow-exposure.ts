import "dotenv/config";
import { prisma } from "../lib/prisma";
import { validateExposureWindow } from "../lib/claim-exposure-timestamp";
import { MEMBERSHIP_CLASSIFICATION_LABELS, type MembershipClassification } from "../lib/claim-exposure-classifier";
import { runExposureDiagnosticQuery, recordExposureDiagnosticExecuted } from "../lib/claim-exposure-diagnostic";

// Sprint SST 1.4C / 1.4C.1 / 1.4D.1 / 1.4D.2 — diagnóstico de
// CompanyMembership potencialmente criadas pelo fluxo inseguro de
// app/api/register/route.ts, ativo entre o deploy do commit 42fc120 (que
// continha a concessão automática de ADMIN a partir do CNPJ) e a
// implantação da contenção. Nunca apaga/altera nada — só relata para
// revisão manual. Nunca imprime CNPJ/e-mail completos.
//
// Sprint SST 1.4D.2, §2 — descrição corrigida: este script NUNCA é
// estritamente "somente leitura" (nomenclatura usada até a Sprint 1.4D.1).
// Desde a Sprint SST 1.4D.1 ele persiste um evento de auditoria
// (`platform_admin.exposure_diagnostic_executed`) em `PlatformAuditLog` a
// cada execução — política A do gate de homologação 1.4D.2: manter essa
// auditoria persistente (é o próprio propósito do PlatformAuditLog: toda
// execução do diagnóstico é, em si, uma ação administrativa que deve ficar
// registrada) e documentar precisamente o que isso significa. A garantia
// real e testada (ver lib/claim-exposure-diagnostic.ts e
// tests/tenant-isolation/claim-exposure-diagnostic.test.ts) é:
//
//   NUNCA altera Company, User, CompanyMembership, CompanyClaimRequest,
//   SstProviderCompany ou UserRole — a ÚNICA escrita realizada é um INSERT
//   append-only em PlatformAuditLog (nunca UPDATE, nunca DELETE, em
//   nenhuma tabela). Toda a consulta/classificação em si
//   (`runExposureDiagnosticQuery`, lib/claim-exposure-diagnostic.ts) é 100%
//   leitura.
//
// Por isso o termo usado abaixo (mensagens de CLI) é "não altera dados de
// negócio", nunca mais "somente leitura" sem qualificação.
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
  console.log("Modo: NÃO ALTERA DADOS DE NEGÓCIO — nenhuma Company/User/CompanyMembership/");
  console.log("CompanyClaimRequest/SstProviderCompany/UserRole é criada, alterada ou removida;");
  console.log("nenhuma membership é revogada. Única escrita: um registro append-only desta");
  console.log("execução em PlatformAuditLog (platform_admin.exposure_diagnostic_executed).");
  console.log("=".repeat(78));
  console.log();

  await recordExposureDiagnosticExecuted(since, until);

  const { totalActiveMemberships, counts, manualReviewEntries } = await runExposureDiagnosticQuery(since, until);

  console.log(`Total de CompanyMembership ACTIVE no sistema: ${totalActiveMemberships}`);
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
      const label = entry.classification === "SUSPICIOUS_INSECURE_FLOW" ? "[SUSPEITA]  " : "[REVISAR]   ";
      console.log(`${label}membership=${entry.membershipId}`);
      console.log(
        `  companyId=${entry.companyId} nome="${entry.companyName}" origin=${entry.companyOrigin} controlStatus=${entry.companyControlStatus}`,
      );
      if (entry.cnpjMasked) console.log(`  cnpj=${entry.cnpjMasked}`);
      console.log(`  userId=${entry.userId} email=${entry.emailMasked}`);
      console.log(`  membership.createdAt=${entry.membershipCreatedAt.toISOString()} user.createdAt=${entry.userCreatedAt.toISOString()}`);
      console.log(`  claim_started AuditLog encontrado: ${entry.hasClaimStartedAuditEvent}`);
      console.log(`  CompanyClaimRequest existente: ${entry.claimRequestStatus ?? "NENHUMA"}`);
      console.log();
    }
  }

  console.log("=".repeat(78));
  console.log("Nenhum dado de negócio foi alterado ou removido (Company/User/CompanyMembership/");
  console.log("CompanyClaimRequest/SstProviderCompany/UserRole). Nenhuma CompanyMembership é");
  console.log("revogada ou corrigida automaticamente por este script. Única escrita realizada:");
  console.log("o registro append-only desta execução em PlatformAuditLog (acima).");
  console.log("=".repeat(78));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
