import "dotenv/config";
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { formatCnpj, isValidCnpj, normalizeCnpj, withValidCheckDigits } from "@/lib/cnpj";

/**
 * Backfill de `documentType`/`documentOriginal`/`documentNormalized` a partir
 * do campo legado `Company.document` (Sprint Comercial SST 1.4 — ver
 * docs/adr/ADR-001 e prisma/schema.prisma). Roda ANTES da migration de
 * unicidade (`@@unique([documentType, documentNormalized])`) — o objetivo
 * desta etapa é só preencher os campos novos, nunca aplicar a constraint.
 *
 * PRÉ-REQUISITO: rodar `npm run diagnose:documents` antes, para conferir que
 * a classificação abaixo ainda reflete o estado real do banco (empresas
 * podem ter sido criadas/editadas entre uma sprint e outra).
 *
 * Uso:
 *   npm run backfill:company-documents -- --dry-run          # simulação
 *   npm run backfill:company-documents -- --apply             # execução real
 *   npm run backfill:company-documents -- --dry-run --json    # simulação em JSON
 *
 * Classificação por empresa (nunca inventa CNPJ para dado que pode ser real):
 *   1. Já tem os 3 campos novos preenchidos -> pulada (idempotente).
 *   2. `document` já é um CNPJ válido -> só espelha nos campos novos
 *      (documentOriginal/documentNormalized), NUNCA reescreve `document`.
 *   3. `document` vazio/nulo E o nome bate com um padrão de dado de
 *      desenvolvimento/teste conhecido (QA/Teste/Vazia/Nova Empresa/Stock —
 *      todos criados manualmente durante sprints anteriores deste projeto,
 *      nunca por um usuário real) -> recebe um CNPJ fictício determinístico
 *      (derivado do próprio id da empresa, sempre o mesmo entre execuções),
 *      válido, e nunca reaproveitado de nenhuma empresa real conhecida.
 *   4. `document` presente mas com dígito verificador inválido E o nome bate
 *      com um dos registros de seed conhecidos (Empresa Demo / âncora SST /
 *      empresas "(Demo SST)") -> substitui pelo CNPJ fictício determinístico
 *      já usado pelos seeds (prisma/seed.ts / prisma/seed-sst-demo.ts),
 *      mantendo `document` sincronizado com o novo valor.
 *   5. Qualquer outro caso (documento ausente/inválido em empresa que NÃO
 *      bate com um padrão de dado de desenvolvimento conhecido) -> NUNCA
 *      inventa CNPJ; reportada como "revisão manual necessária" e não
 *      alterada de forma alguma.
 */

const BATCH_SIZE = 50;

export type Mode = "dry-run" | "apply";

export function parseArgs(argv: string[] = process.argv.slice(2)): { mode: Mode; asJson: boolean } {
  const hasDryRun = argv.includes("--dry-run");
  const hasApply = argv.includes("--apply");
  const asJson = argv.includes("--json");
  if (hasDryRun === hasApply) {
    throw new UsageError("Informe exatamente uma flag: --dry-run (simulação) ou --apply (execução real).");
  }
  return { mode: hasDryRun ? "dry-run" : "apply", asJson };
}

export class UsageError extends Error {}

// CNPJs fictícios determinísticos já usados pelos seeds (Sprint 1.4, §19) —
// espelhados aqui para que o backfill corrija registros de seed já
// existentes no banco (criados por uma versão anterior do seed, com
// placeholder inválido) para o MESMO valor que o seed atual passaria a criar
// — nunca um valor diferente/arbitrário.
const KNOWN_SEED_DOCUMENTS: Record<string, string> = {
  "Empresa Demo": withValidCheckDigits("112223330001"),
  "Consultoria Segura SST — Acesso ao Portal (não remover)": withValidCheckDigits("000000000008"),
  "Metalúrgica Alfa (Demo SST)": withValidCheckDigits("000000000009"),
  "Construtora Beta (Demo SST)": withValidCheckDigits("000000000010"),
  "Transportadora Gama (Demo SST)": withValidCheckDigits("000000000011"),
  "Indústria Delta (Demo SST)": withValidCheckDigits("000000000012"),
  "Comércio Épsilon (Demo SST)": withValidCheckDigits("000000000013"),
};

// Padrão de nomes de empresas criadas manualmente durante testes/QA neste
// projeto (nunca por um usuário real via /register) — únicas candidatas a
// receber um CNPJ fictício GERADO (ao contrário de KNOWN_SEED_DOCUMENTS,
// que usa um valor fixo conhecido). Qualquer nome fora deste padrão E fora
// de KNOWN_SEED_DOCUMENTS é tratado como possível dado real e nunca recebe
// um CNPJ inventado.
const DEV_TEST_NAME_PATTERN = /^(QA Empresa|Empresa Teste|Empresa Mascara Teste|Empresa Com Celular|Empresa Vazia|Nova Empresa|Empresa Stock|Empresa [A-Z] Teste)/;

/** Deriva 12 dígitos determinísticos a partir do id da empresa (mesmo id ->
 * sempre o mesmo CNPJ fictício) — usado só para dado de desenvolvimento/QA
 * sem nenhuma correspondência com uma empresa real. */
function deterministicBase12FromId(companyId: string): string {
  const hash = createHash("sha256").update(companyId).digest();
  let digits = "";
  for (let i = 0; i < 12; i++) digits += String(hash[i] % 10);
  return digits;
}

type CompanyRow = {
  id: string;
  name: string;
  document: string | null;
  documentType: string | null;
  documentOriginal: string | null;
  documentNormalized: string | null;
};

export type Outcome =
  | { kind: "already-backfilled"; company: CompanyRow }
  | { kind: "mirrored-valid"; company: CompanyRow; documentNormalized: string }
  | { kind: "assigned-dev-fictional"; company: CompanyRow; newDocument: string }
  | { kind: "corrected-seed-placeholder"; company: CompanyRow; newDocument: string }
  | { kind: "needs-manual-review"; company: CompanyRow; reason: string };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function classify(company: CompanyRow): Outcome {
  if (company.documentType && company.documentOriginal && company.documentNormalized) {
    return { kind: "already-backfilled", company };
  }

  const raw = (company.document ?? "").trim();

  if (raw !== "" && isValidCnpj(raw)) {
    return { kind: "mirrored-valid", company, documentNormalized: normalizeCnpj(raw) };
  }

  if (raw === "" && DEV_TEST_NAME_PATTERN.test(company.name)) {
    const generated = withValidCheckDigits(deterministicBase12FromId(company.id));
    return { kind: "assigned-dev-fictional", company, newDocument: formatCnpj(generated) };
  }

  if (raw !== "" && !isValidCnpj(raw) && company.name in KNOWN_SEED_DOCUMENTS) {
    return { kind: "corrected-seed-placeholder", company, newDocument: formatCnpj(KNOWN_SEED_DOCUMENTS[company.name]) };
  }

  return {
    kind: "needs-manual-review",
    company,
    reason:
      raw === ""
        ? "sem documento e o nome não corresponde a nenhum padrão de dado de desenvolvimento conhecido — pode ser cadastro real incompleto."
        : "documento presente mas com dígito verificador inválido, e não corresponde a nenhum registro de seed conhecido — pode ser CNPJ real digitado incorretamente. NUNCA inventar um CNPJ substituto.",
  };
}

async function applyOutcome(outcome: Outcome, mode: Mode): Promise<void> {
  if (mode === "dry-run") return;
  if (outcome.kind === "already-backfilled" || outcome.kind === "needs-manual-review") return;

  if (outcome.kind === "mirrored-valid") {
    const original = formatCnpj(outcome.company.document);
    await prisma.company.update({
      where: { id: outcome.company.id },
      data: { documentType: "CNPJ", documentOriginal: original, documentNormalized: outcome.documentNormalized },
    });
    return;
  }

  // assigned-dev-fictional / corrected-seed-placeholder: escreve o novo
  // `document` (mascarado) e os 3 campos novos na mesma atualização.
  await prisma.company.update({
    where: { id: outcome.company.id },
    data: {
      document: outcome.newDocument,
      documentType: "CNPJ",
      documentOriginal: outcome.newDocument,
      documentNormalized: normalizeCnpj(outcome.newDocument),
    },
  });
}

export type Summary = {
  mode: Mode;
  generatedAt: string;
  totalCompanies: number;
  alreadyBackfilled: number;
  mirroredValid: number;
  assignedDevFictional: number;
  correctedSeedPlaceholder: number;
  needsManualReview: number;
};

export async function runBackfill(mode: Mode): Promise<{ summary: Summary; outcomes: Outcome[] }> {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, document: true, documentType: true, documentOriginal: true, documentNormalized: true },
    orderBy: { createdAt: "asc" },
  });

  const outcomes: Outcome[] = [];
  for (const batch of chunk(companies, BATCH_SIZE)) {
    for (const company of batch) {
      const outcome = classify(company);
      await applyOutcome(outcome, mode);
      outcomes.push(outcome);
    }
  }

  const count = (kind: Outcome["kind"]) => outcomes.filter((o) => o.kind === kind).length;
  const summary: Summary = {
    mode,
    generatedAt: new Date().toISOString(),
    totalCompanies: companies.length,
    alreadyBackfilled: count("already-backfilled"),
    mirroredValid: count("mirrored-valid"),
    assignedDevFictional: count("assigned-dev-fictional"),
    correctedSeedPlaceholder: count("corrected-seed-placeholder"),
    needsManualReview: count("needs-manual-review"),
  };

  return { summary, outcomes };
}

function printReport(summary: Summary, outcomes: Outcome[], asJson: boolean) {
  const manualReview = outcomes.filter(
    (o): o is Extract<Outcome, { kind: "needs-manual-review" }> => o.kind === "needs-manual-review",
  );

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          summary,
          needsManualReview: manualReview.map((o) => ({
            id: o.company.id,
            name: o.company.name,
            document: o.company.document,
            reason: o.reason,
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
  lines.push(`Backfill de documentos de empresa — modo: ${summary.mode.toUpperCase()}`);
  lines.push("=".repeat(72));
  lines.push(`Gerado em: ${summary.generatedAt}`);
  lines.push("");
  lines.push(`Total de empresas .......................... ${summary.totalCompanies}`);
  lines.push(`Já preenchidas (puladas) ................... ${summary.alreadyBackfilled}`);
  lines.push(`CNPJ já válido, só espelhado ................ ${summary.mirroredValid}`);
  lines.push(`Dado de dev/QA — CNPJ fictício atribuído .... ${summary.assignedDevFictional}`);
  lines.push(`Placeholder de seed corrigido ............... ${summary.correctedSeedPlaceholder}`);
  lines.push(`PRECISA DE REVISÃO MANUAL (não alteradas) ... ${summary.needsManualReview}`);
  lines.push("");

  if (manualReview.length > 0) {
    lines.push(`Empresas que precisam de revisão manual (${manualReview.length}) — NÃO alteradas:`);
    for (const o of manualReview) {
      lines.push(`  - ${o.company.id} | ${o.company.name} | document="${o.company.document ?? "(null)"}"`);
      lines.push(`    motivo: ${o.reason}`);
    }
    lines.push("");
  }

  lines.push(
    summary.mode === "dry-run"
      ? "Nenhuma escrita foi realizada (--dry-run). Rode com --apply para executar de verdade."
      : "Execução real concluída.",
  );
  console.log(lines.join("\n"));
}

async function main() {
  const { mode, asJson } = parseArgs();
  const { summary, outcomes } = await runBackfill(mode);
  printReport(summary, outcomes, asJson);
}

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
