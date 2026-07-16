import "dotenv/config";
import { prisma } from "../lib/prisma";
import { grantPlatformAdmin, hasAnyActiveSuperAdmin, parseEmailArg, parseArgValue } from "../lib/platform-admin-bootstrap";

// Sprint SST 1.4D, §4 / Sprint SST 1.4D.1, §7 — único jeito de conceder
// acesso ao Portal Super Admin Lite. Nunca cria credencial fixa; exige que
// o usuário Better Auth já exista.
//
// PRIMEIRO bootstrap (nenhum SUPER_ADMIN ativo ainda):
//   npm run platform-admin:grant -- --email=usuario@dominio.com \
//     --confirm-first-bootstrap --reason="Criação do primeiro administrador interno"
//
// Concessões POSTERIORES (já existe pelo menos um SUPER_ADMIN ativo):
//   npm run platform-admin:grant -- --email=usuario@dominio.com \
//     --granted-by=admin-responsavel@dominio.com --reason="Aprovado em reunião de segurança"
//
// A identificação do administrador responsável (`--granted-by`) NÃO é
// criptograficamente forte — é só um e-mail informado na linha de comando
// por quem está operando o terminal, nunca uma prova de identidade.

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const email = parseEmailArg(argv);
  const reason = parseArgValue(argv, "reason");
  const grantedByEmail = parseArgValue(argv, "granted-by");
  const isFirstBootstrapConfirmed = argv.includes("--confirm-first-bootstrap");

  if (!email) {
    console.error("ERRO: informe --email=usuario@dominio.com");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!reason) {
    console.error("ERRO: informe --reason=\"motivo da concessão\" — obrigatório em qualquer caminho.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const alreadyBootstrapped = await hasAnyActiveSuperAdmin();

  if (!alreadyBootstrapped) {
    if (!isFirstBootstrapConfirmed) {
      console.error("ERRO: nenhum SUPER_ADMIN ativo existe ainda — este é o PRIMEIRO bootstrap.");
      console.error("Confirme explicitamente com --confirm-first-bootstrap.");
      console.error(
        'Uso: npm run platform-admin:grant -- --email=usuario@dominio.com --confirm-first-bootstrap --reason="Criação do primeiro administrador interno"',
      );
      process.exitCode = 1;
      await prisma.$disconnect();
      return;
    }
  } else if (!grantedByEmail) {
    console.error("ERRO: já existe pelo menos um SUPER_ADMIN ativo — informe o administrador responsável com --granted-by=email.");
    console.error(
      'Uso: npm run platform-admin:grant -- --email=usuario@dominio.com --granted-by=admin-responsavel@dominio.com --reason="motivo"',
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const result = await grantPlatformAdmin(
    email,
    !alreadyBootstrapped
      ? { kind: "FIRST_BOOTSTRAP", reason }
      : { kind: "GRANTED_BY", grantedByEmail: grantedByEmail as string, reason },
  );

  if (!result.ok) {
    if (result.reason === "USER_NOT_FOUND") {
      console.error(`ERRO: nenhum usuário encontrado com o e-mail ${maskEmail(email)}.`);
      console.error("O usuário precisa se cadastrar (Better Auth) antes de receber acesso de Super Admin.");
    } else if (result.reason === "GRANTER_NOT_FOUND") {
      console.error(`ERRO: nenhum usuário encontrado com o e-mail informado em --granted-by.`);
    } else if (result.reason === "GRANTER_NOT_ACTIVE_SUPER_ADMIN") {
      console.error("ERRO: o e-mail informado em --granted-by não corresponde a um SUPER_ADMIN ativo.");
    } else if (result.reason === "FIRST_BOOTSTRAP_ALREADY_DONE") {
      console.error("ERRO: já existe pelo menos um SUPER_ADMIN ativo — use --granted-by=email em vez de --confirm-first-bootstrap.");
    }
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
