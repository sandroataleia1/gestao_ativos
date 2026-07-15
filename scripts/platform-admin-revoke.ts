import "dotenv/config";
import { prisma } from "../lib/prisma";
import { parseEmailArg, revokePlatformAdmin } from "../lib/platform-admin-bootstrap";

// Sprint SST 1.4D, §4 — revoga o acesso de Super Admin. Ação destrutiva:
// exige confirmação explícita (--confirm) e, para revogar o ÚLTIMO
// SUPER_ADMIN ativo, a flag extraordinária --force (documentada abaixo).
//
// Uso: npm run platform-admin:revoke -- --email=usuario@dominio.com --confirm
// Último admin ativo: adicionar também --force (só use se tiver certeza —
// ninguém mais poderá conceder acesso de Super Admin depois disso, exceto
// via acesso direto ao banco).

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const email = parseEmailArg(argv);
  const confirmed = argv.includes("--confirm");
  const force = argv.includes("--force");

  if (!email) {
    console.error("ERRO: informe --email=usuario@dominio.com");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!confirmed) {
    console.error("ERRO: revogação exige confirmação explícita — adicione --confirm.");
    console.error("Uso: npm run platform-admin:revoke -- --email=usuario@dominio.com --confirm");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const result = await revokePlatformAdmin(email, { force });

  if (!result.ok) {
    if (result.reason === "USER_NOT_FOUND") {
      console.error(`ERRO: nenhum usuário encontrado com o e-mail ${maskEmail(email)}.`);
    } else if (result.reason === "PLATFORM_USER_NOT_FOUND") {
      console.error(`ERRO: ${maskEmail(email)} nunca teve acesso de Super Admin — nada para revogar.`);
    } else if (result.reason === "LAST_ACTIVE_SUPER_ADMIN") {
      console.error(`ERRO: ${maskEmail(email)} é o ÚLTIMO SUPER_ADMIN ativo.`);
      console.error("Revogar deixaria a plataforma sem ninguém capaz de conceder acesso de Super Admin.");
      console.error("Se isso é mesmo o que você quer, rode de novo com a flag --force.");
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
