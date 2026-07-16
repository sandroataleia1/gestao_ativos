import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseEmailArg, parseArgValue, revokePlatformAdmin } from "../lib/platform-admin-bootstrap";

// Sprint SST 1.4D, §4 / Sprint SST 1.4D.1, §8 — revoga o acesso de Super
// Admin. Ação destrutiva: exige confirmação explícita (--confirm) e motivo
// (--reason). Para revogar o ÚLTIMO SUPER_ADMIN ativo, exige a flag
// extraordinária e nomeada `--allow-no-active-super-admin` (nunca um
// `--force` genérico) MAIS a confirmação adicional
// `--confirm-empty-platform` — duas flags distintas, de propósito, para que
// ninguém acione esse caso extraordinário por engano.
//
// Uso:
//   npm run platform-admin:revoke -- --email=usuario@dominio.com --confirm --reason="motivo"
//
// Último admin ativo (extraordinário):
//   npm run platform-admin:revoke -- --email=usuario@dominio.com --confirm --reason="motivo" \
//     --allow-no-active-super-admin --confirm-empty-platform

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const email = parseEmailArg(argv);
  const reason = parseArgValue(argv, "reason");
  const revokedByEmail = parseArgValue(argv, "revoked-by") ?? undefined;
  const confirmed = argv.includes("--confirm");
  const allowNoActiveSuperAdmin = argv.includes("--allow-no-active-super-admin");
  const confirmEmptyPlatform = argv.includes("--confirm-empty-platform");

  if (!email) {
    console.error("ERRO: informe --email=usuario@dominio.com");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!confirmed) {
    console.error("ERRO: revogação exige confirmação explícita — adicione --confirm.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!reason) {
    console.error('ERRO: revogação exige motivo — adicione --reason="motivo da revogação".');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (allowNoActiveSuperAdmin && !confirmEmptyPlatform) {
    console.error("ERRO: --allow-no-active-super-admin exige também a confirmação adicional --confirm-empty-platform.");
    console.error("Isso deixaria a plataforma temporariamente sem NENHUM Super Admin ativo — confirme que é intencional.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const result = await revokePlatformAdmin(email, { reason, allowNoActiveSuperAdmin, revokedByEmail });

  if (!result.ok) {
    if (result.reason === "USER_NOT_FOUND") {
      console.error(`ERRO: nenhum usuário encontrado com o e-mail ${maskEmail(email)}.`);
    } else if (result.reason === "PLATFORM_USER_NOT_FOUND") {
      console.error(`ERRO: ${maskEmail(email)} nunca teve acesso de Super Admin — nada para revogar.`);
    } else if (result.reason === "LAST_ACTIVE_SUPER_ADMIN") {
      console.error(`ERRO: ${maskEmail(email)} é o ÚLTIMO SUPER_ADMIN ativo.`);
      console.error("Revogar deixaria a plataforma sem ninguém capaz de conceder acesso de Super Admin.");
      console.error("Se isso é mesmo o que você quer, rode de novo com --allow-no-active-super-admin --confirm-empty-platform.");
    }
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  if (result.alreadyInactive) {
    console.log(`${result.userEmail} já estava com o acesso de Super Admin revogado — nada a fazer.`);
  } else {
    console.log(`Acesso de Super Admin revogado para ${result.userEmail} (platformUserId=${result.platformUserId}).`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
