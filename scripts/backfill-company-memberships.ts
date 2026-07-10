import "dotenv/config";

import { prisma } from "@/lib/prisma";

/**
 * Backfill M2B — cria uma `CompanyMembership` ACTIVE para cada par legado
 * `(User.id, User.companyId)`.
 *
 * PRÉ-REQUISITO: a migration M2A (tabela `CompanyMembership`) precisa estar
 * aplicada e o Prisma Client regenerado (`npx prisma generate`) — antes
 * disso este script nem compila (o model `companyMembership` não existe no
 * client gerado). Ver prisma/proposed/M2A_add_company_memberships.sql.
 *
 * Uso:
 *   npm run backfill:company-memberships -- --dry-run          # simulação, não escreve nada
 *   npm run backfill:company-memberships -- --apply             # execução real
 *   npm run backfill:company-memberships -- --dry-run --json    # simulação em JSON
 *
 * Exatamente um de --dry-run / --apply é obrigatório — sem isso, o script
 * recusa rodar (erro de uso, não uma falha técnica silenciosa).
 *
 * Regras:
 *   - Nunca altera User.companyId nem UserRole.
 *   - Nunca inventa invitedByUserId (fica sempre null — backfill não é convite).
 *   - Nunca sobrescreve uma membership pré-existente (idempotente: uma
 *     membership já existente para o par é reportada como "já existente" ou
 *     "conflito", nunca atualizada silenciosamente).
 *   - `invitedAt`/`activatedAt` usam `User.createdAt` como a melhor
 *     aproximação histórica real disponível (o usuário pertence a essa
 *     empresa, sob o modelo atual de 1 empresa por usuário, desde que a
 *     conta foi criada) — não inventa uma data que não temos.
 *   - Processa em lotes (BATCH_SIZE), não numa única transação gigante.
 *   - Encerra com código != 0 apenas em falha técnica real (ex.: banco
 *     indisponível) — conflitos/registros pulados são resultado esperado do
 *     backfill, não erro.
 */

const BATCH_SIZE = 50;

export type Mode = "dry-run" | "apply";

export function parseArgs(argv: string[] = process.argv.slice(2)): { mode: Mode; asJson: boolean } {
  const hasDryRun = argv.includes("--dry-run");
  const hasApply = argv.includes("--apply");
  const asJson = argv.includes("--json");

  if (hasDryRun === hasApply) {
    // ambos ausentes OU ambos presentes — uso inválido, recusa explicitamente.
    throw new UsageError(
      "Informe exatamente uma flag: --dry-run (simulação, não escreve nada) ou --apply (execução real).",
    );
  }

  return { mode: hasDryRun ? "dry-run" : "apply", asJson };
}

export class UsageError extends Error {}

export type LegacyPair = { userId: string; userEmail: string; companyId: string; userCreatedAt: Date };

export type Outcome =
  | { kind: "created"; pair: LegacyPair }
  | { kind: "already-backfilled"; pair: LegacyPair; membershipId: string }
  | { kind: "conflict"; pair: LegacyPair; membershipId: string; reason: string }
  | { kind: "would-create"; pair: LegacyPair };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function processBatch(pairs: LegacyPair[], mode: Mode): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];

  for (const pair of pairs) {
    const existing = await prisma.companyMembership.findUnique({
      where: { userId_companyId: { userId: pair.userId, companyId: pair.companyId } },
    });

    if (existing) {
      // Nunca sobrescreve — só classifica. "Já feito por este backfill" =
      // exatamente o formato que este script produziria (ACTIVE, sem
      // invitedByUserId); qualquer outra coisa é um conflito para revisão
      // manual, não uma decisão automática.
      const looksLikeOurOwnBackfill = existing.status === "ACTIVE" && existing.invitedByUserId === null;
      if (looksLikeOurOwnBackfill) {
        outcomes.push({ kind: "already-backfilled", pair, membershipId: existing.id });
      } else {
        outcomes.push({
          kind: "conflict",
          pair,
          membershipId: existing.id,
          reason: `membership existente com status=${existing.status}, invitedByUserId=${existing.invitedByUserId ?? "null"} — não corresponde ao formato esperado de backfill; não sobrescrito.`,
        });
      }
      continue;
    }

    if (mode === "dry-run") {
      outcomes.push({ kind: "would-create", pair });
      continue;
    }

    // `id` gerado pelo Prisma (`@default(cuid())`) — nunca gerado manualmente aqui.
    await prisma.companyMembership.create({
      data: {
        userId: pair.userId,
        companyId: pair.companyId,
        status: "ACTIVE",
        invitedByUserId: null,
        invitedAt: pair.userCreatedAt,
        activatedAt: pair.userCreatedAt,
      },
    });
    outcomes.push({ kind: "created", pair });
  }

  return outcomes;
}

export type Summary = {
  mode: Mode;
  generatedAt: string;
  totalLegacyPairs: number;
  created: number;
  wouldCreate: number;
  alreadyBackfilled: number;
  conflicts: number;
};

/**
 * Lógica central do backfill, reutilizável tanto pela CLI (`main`) quanto
 * pelos testes de integração (tests/tenant-isolation/company-membership*.ts)
 * — os testes importam esta função diretamente em vez de invocar o processo
 * via subshell, para rodar contra o mesmo banco guardado por
 * tests/setup.ts.
 */
export async function runBackfill(mode: Mode): Promise<{ summary: Summary; outcomes: Outcome[] }> {
  const users = await prisma.user.findMany({
    where: { companyId: { not: "" } },
    select: { id: true, email: true, companyId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const pairs: LegacyPair[] = users.map((u) => ({
    userId: u.id,
    userEmail: u.email,
    companyId: u.companyId,
    userCreatedAt: u.createdAt,
  }));

  const outcomes: Outcome[] = [];
  for (const batch of chunk(pairs, BATCH_SIZE)) {
    outcomes.push(...(await processBatch(batch, mode)));
  }

  const created = outcomes.filter((o) => o.kind === "created");
  const wouldCreate = outcomes.filter((o) => o.kind === "would-create");
  const alreadyBackfilled = outcomes.filter((o) => o.kind === "already-backfilled");
  const conflicts = outcomes.filter((o) => o.kind === "conflict");

  const summary: Summary = {
    mode,
    generatedAt: new Date().toISOString(),
    totalLegacyPairs: pairs.length,
    created: created.length,
    wouldCreate: wouldCreate.length,
    alreadyBackfilled: alreadyBackfilled.length,
    conflicts: conflicts.length,
  };

  return { summary, outcomes };
}

function printReport(summary: Summary, outcomes: Outcome[], asJson: boolean) {
  const conflicts = outcomes.filter((o): o is Extract<Outcome, { kind: "conflict" }> => o.kind === "conflict");

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          summary,
          conflicts: conflicts.map((c) => ({
            userId: c.pair.userId,
            userEmail: c.pair.userEmail,
            companyId: c.pair.companyId,
            membershipId: c.membershipId,
            reason: c.reason,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push(`Backfill de CompanyMembership — modo: ${summary.mode.toUpperCase()}`);
  lines.push("=".repeat(72));
  lines.push(`Gerado em: ${summary.generatedAt}`);
  lines.push("");
  lines.push(`Total de pares legados (User.id + User.companyId): ${summary.totalLegacyPairs}`);
  if (summary.mode === "dry-run") {
    lines.push(`Seriam criadas: ${summary.wouldCreate}`);
  } else {
    lines.push(`Criadas agora: ${summary.created}`);
  }
  lines.push(`Já existiam (formato de backfill, ignoradas): ${summary.alreadyBackfilled}`);
  lines.push(`Conflitos (existiam com formato diferente, NÃO alteradas): ${summary.conflicts}`);
  lines.push("");

  if (conflicts.length > 0) {
    lines.push(`Conflitos (${conflicts.length}) — revisão manual recomendada:`);
    for (const c of conflicts) {
      lines.push(`  - user=${c.pair.userId} (${c.pair.userEmail}) company=${c.pair.companyId} membership=${c.membershipId}`);
      lines.push(`    motivo: ${c.reason}`);
    }
    lines.push("");
  }

  if (summary.mode === "dry-run") {
    lines.push("Nenhuma escrita foi realizada (--dry-run). Rode com --apply para executar de verdade.");
  } else {
    lines.push("Execução real concluída.");
  }

  console.log(lines.join("\n"));
}

async function main() {
  const { mode, asJson } = parseArgs();
  const { summary, outcomes } = await runBackfill(mode);
  printReport(summary, outcomes, asJson);
}

// Só roda a CLI (com process.exit) quando executado diretamente — quando
// importado pelos testes (Vitest define process.env.VITEST), `main()` nunca
// é chamado automaticamente, evitando um process.exit() no meio da suíte.
if (!process.env.VITEST) {
  main()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      if (error instanceof UsageError) {
        console.error(`Erro de uso: ${error.message}`);
        await prisma.$disconnect().catch(() => {});
        process.exit(1);
      }
      console.error("Falha técnica ao executar o backfill:");
      console.error(error instanceof Error ? error.message : error);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
}
