import "dotenv/config";
import { prisma } from "../lib/prisma";
import { grantPlatformAdmin, parseEmailArg } from "../lib/platform-admin-bootstrap";

// Sprint SST 1.4D, §4 — único jeito de conceder acesso ao Portal Super
// Admin Lite. Nunca cria credencial fixa; exige que o usuário Better Auth
// já exista.
//
// Uso: npm run platform-admin:grant -- --email=usuario@dominio.com

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const email = parseEmailArg(process.argv.slice(2));
  if (!email) {
    console.error("ERRO: informe --email=usuario@dominio.com");
    console.error("Uso: npm run platform-admin:grant -- --email=usuario@dominio.com");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const result = await grantPlatformAdmin(email);
  if (!result.ok) {
    console.error(`ERRO: nenhum usuário encontrado com o e-mail ${maskEmail(email)}.`);
    console.error("O usuário precisa se cadastrar (Better Auth) antes de receber acesso de Super Admin.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log(`Usuário encontrado: ${result.userEmail} (id=${result.userId})`);
  if (result.created) {
    console.log(`PlatformUser SUPER_ADMIN criado (id=${result.platformUserId}).`);
  } else if (result.reactivated) {
    console.log(`PlatformUser SUPER_ADMIN reativado (id=${result.platformUserId}).`);
  } else {
    console.log(`PlatformUser SUPER_ADMIN já estava ativo (id=${result.platformUserId}) — nada a fazer.`);
  }
  console.log("Nenhuma CompanyMembership foi criada. User.companyId não foi alterado. Senha não foi alterada.");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
