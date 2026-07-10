import "dotenv/config";

import { prisma } from "@/lib/prisma";

/**
 * Diagnóstico SOMENTE-LEITURA do campo `Company.document` (CNPJ).
 *
 * Objetivo: dar visibilidade completa do estado atual dos documentos das
 * empresas ANTES de qualquer decisão sobre normalização/unicidade (Migration
 * M1 e a futura constraint única — ver docs/adr/ADR-001). Este script NUNCA
 * escreve no banco: não faz update, insert, delete nem migração. É seguro
 * rodar em qualquer ambiente (dev/homolog/prod).
 *
 * Uso:
 *   npx tsx scripts/diagnose-company-documents.ts            # saída legível
 *   npx tsx scripts/diagnose-company-documents.ts --json     # saída JSON
 *   npm run diagnose:documents                               # atalho (package.json)
 *   npm run diagnose:documents -- --json
 *
 * Código de saída:
 *   0  -> execução bem-sucedida (mesmo que encontre dados inválidos/duplicados)
 *   1  -> erro TÉCNICO (ex.: falha de conexão com o banco)
 *
 * Encontrar documentos inválidos NÃO é erro técnico — é justamente o
 * resultado esperado do diagnóstico, então o processo encerra com 0.
 */

// --- Utilidades puras (sem I/O) ---------------------------------------------

/** Remove tudo que não for dígito. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Caracteres de máscara "esperados" de um CNPJ formatado: . / - e espaço. */
const MASK_CHARS = /[.\-/\s]/g;

/** true se o valor contém algum caractere de formatação de máscara. */
function hasMaskChars(value: string): boolean {
  return /[.\-/]/.test(value);
}

/**
 * true se, além dos dígitos e dos caracteres de máscara padrão, ainda sobra
 * algum caractere (ex.: letras, símbolos estranhos) — sinaliza dado "sujo"
 * que não é apenas um CNPJ mascarado.
 */
function hasUnexpectedChars(value: string): boolean {
  const stripped = value.replace(/\d/g, "").replace(MASK_CHARS, "");
  return stripped.length > 0;
}

/**
 * Validação dos dígitos verificadores de um CNPJ numérico (14 dígitos).
 * Não valida o CNPJ alfanumérico (regra nova da Receita, vigente a partir de
 * 2026) — este diagnóstico assume o formato numérico clássico e apenas
 * sinaliza divergências; não corrige nada.
 */
function isValidCnpjCheckDigits(digits: string): boolean {
  if (digits.length !== 14) return false;
  // Rejeita sequências repetidas (00000000000000, 11111111111111, ...), que
  // passam na aritmética dos DVs mas nunca são CNPJs reais.
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dv1 = calcDigit(digits.slice(0, 12), firstWeights);
  if (dv1 !== Number(digits[12])) return false;
  const dv2 = calcDigit(digits.slice(0, 13), secondWeights);
  return dv2 === Number(digits[13]);
}

// --- Tipos do relatório ------------------------------------------------------

type CompanyRow = { id: string; name: string; document: string | null };

type ConflictGroup = {
  key: string;
  companies: CompanyRow[];
};

type Report = {
  generatedAt: string;
  database: string; // host/porta/banco, SEM usuário/senha (nunca logar segredo)
  totals: {
    totalCompanies: number;
    withoutDocument: number;
    withMask: number;
    withNonNumericChars: number;
    wrongDigitCount: number;
    invalidCheckDigits: number;
    exactDuplicateGroups: number;
    normalizedDuplicateGroups: number;
  };
  exactDuplicates: ConflictGroup[];
  normalizedDuplicates: ConflictGroup[];
};

// --- Coleta e classificação (leitura pura) ----------------------------------

/**
 * Extrai host:porta/banco da connection string SEM expor usuário/senha —
 * apenas para o relatório saber contra qual banco rodou. Se algo der errado
 * no parse, devolve um rótulo neutro (nunca a string crua com credenciais).
 */
function describeDatabaseTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL não definido)";
  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\//, "") || "(sem nome)";
    return `${url.hostname}:${url.port || "5432"}/${dbName}`;
  } catch {
    return "(connection string não parseável)";
  }
}

function buildReport(companies: CompanyRow[]): Report {
  const withoutDocument: CompanyRow[] = [];
  const withMask: CompanyRow[] = [];
  const withNonNumericChars: CompanyRow[] = [];
  const wrongDigitCount: CompanyRow[] = [];
  const invalidCheckDigits: CompanyRow[] = [];

  const exactMap = new Map<string, CompanyRow[]>();
  const normalizedMap = new Map<string, CompanyRow[]>();

  for (const company of companies) {
    const raw = (company.document ?? "").trim();

    if (raw === "") {
      withoutDocument.push(company);
      continue; // vazio não participa das demais checagens nem de duplicidade
    }

    if (hasMaskChars(raw)) withMask.push(company);
    if (hasUnexpectedChars(raw)) withNonNumericChars.push(company);

    const digits = digitsOnly(raw);
    if (digits.length !== 14) {
      wrongDigitCount.push(company);
    } else if (!isValidCnpjCheckDigits(digits)) {
      invalidCheckDigits.push(company);
    }

    // Duplicidade exata: valor cru idêntico (case-sensitive, como está no banco).
    const exactKey = raw;
    exactMap.set(exactKey, [...(exactMap.get(exactKey) ?? []), company]);

    // Duplicidade após normalização: só dígitos. Só faz sentido comparar
    // quando há dígitos (documento totalmente não-numérico vira "").
    if (digits.length > 0) {
      normalizedMap.set(digits, [...(normalizedMap.get(digits) ?? []), company]);
    }
  }

  const toGroups = (map: Map<string, CompanyRow[]>): ConflictGroup[] =>
    [...map.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({ key, companies: rows }))
      .sort((a, b) => b.companies.length - a.companies.length);

  const exactDuplicates = toGroups(exactMap);
  const normalizedDuplicates = toGroups(normalizedMap);

  return {
    generatedAt: new Date().toISOString(),
    database: describeDatabaseTarget(),
    totals: {
      totalCompanies: companies.length,
      withoutDocument: withoutDocument.length,
      withMask: withMask.length,
      withNonNumericChars: withNonNumericChars.length,
      wrongDigitCount: wrongDigitCount.length,
      invalidCheckDigits: invalidCheckDigits.length,
      exactDuplicateGroups: exactDuplicates.length,
      normalizedDuplicateGroups: normalizedDuplicates.length,
    },
    exactDuplicates,
    normalizedDuplicates,
    // Listas detalhadas anexadas fora do tipo estrito para a saída legível/JSON
    ...( {
      _details: {
        withoutDocument,
        withMask,
        withNonNumericChars,
        wrongDigitCount,
        invalidCheckDigits,
      },
    } as unknown as object),
  } as Report & { _details: Record<string, CompanyRow[]> };
}

// --- Renderização ------------------------------------------------------------

function fmtCompany(c: CompanyRow): string {
  const doc = c.document === null ? "(null)" : `"${c.document}"`;
  return `  - ${c.id}  |  ${c.name}  |  ${doc}`;
}

function renderHuman(report: Report & { _details: Record<string, CompanyRow[]> }): string {
  const t = report.totals;
  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push("Diagnóstico de documentos (CNPJ) das empresas — SOMENTE LEITURA");
  lines.push("=".repeat(72));
  lines.push(`Gerado em:  ${report.generatedAt}`);
  lines.push(`Banco:      ${report.database}`);
  lines.push("");
  lines.push("Resumo:");
  lines.push(`  Total de empresas ............................... ${t.totalCompanies}`);
  lines.push(`  Sem documento (null/vazio) ...................... ${t.withoutDocument}`);
  lines.push(`  Com máscara (. / -) ............................. ${t.withMask}`);
  lines.push(`  Com caracteres não-numéricos inesperados ........ ${t.withNonNumericChars}`);
  lines.push(`  Com quantidade != 14 dígitos .................... ${t.wrongDigitCount}`);
  lines.push(`  Com dígitos verificadores inválidos ............. ${t.invalidCheckDigits}`);
  lines.push(`  Grupos de duplicidade exata ..................... ${t.exactDuplicateGroups}`);
  lines.push(`  Grupos de duplicidade após normalização ......... ${t.normalizedDuplicateGroups}`);
  lines.push("");

  const section = (title: string, rows: CompanyRow[]) => {
    if (rows.length === 0) return;
    lines.push(`${title} (${rows.length}):`);
    for (const row of rows) lines.push(fmtCompany(row));
    lines.push("");
  };

  section("Empresas SEM documento", report._details.withoutDocument);
  section("Empresas com máscara", report._details.withMask);
  section("Empresas com caracteres não-numéricos inesperados", report._details.withNonNumericChars);
  section("Empresas com quantidade de dígitos != 14", report._details.wrongDigitCount);
  section("Empresas com dígitos verificadores inválidos", report._details.invalidCheckDigits);

  if (report.exactDuplicates.length > 0) {
    lines.push(`Duplicidades EXATAS (mesmo valor cru) — ${report.exactDuplicates.length} grupo(s):`);
    for (const group of report.exactDuplicates) {
      lines.push(`  valor "${group.key}" aparece ${group.companies.length}x:`);
      for (const row of group.companies) lines.push(fmtCompany(row));
    }
    lines.push("");
  }

  if (report.normalizedDuplicates.length > 0) {
    lines.push(
      `Duplicidades APÓS NORMALIZAÇÃO (mesmos 14 dígitos) — ${report.normalizedDuplicates.length} grupo(s):`,
    );
    for (const group of report.normalizedDuplicates) {
      lines.push(`  dígitos "${group.key}" aparecem ${group.companies.length}x:`);
      for (const row of group.companies) lines.push(fmtCompany(row));
    }
    lines.push("");
  }

  lines.push("Nenhum dado foi modificado. Diagnóstico somente-leitura.");
  return lines.join("\n");
}

// --- Entrypoint --------------------------------------------------------------

async function main() {
  const asJson = process.argv.includes("--json");

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, document: true },
    orderBy: { createdAt: "asc" },
  });

  const report = buildReport(companies) as Report & { _details: Record<string, CompanyRow[]> };

  if (asJson) {
    // No JSON, expomos os detalhes junto — mesma informação da saída legível.
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          database: report.database,
          totals: report.totals,
          details: report._details,
          exactDuplicates: report.exactDuplicates,
          normalizedDuplicates: report.normalizedDuplicates,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderHuman(report));
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    // Erro TÉCNICO (ex.: banco indisponível) — este sim encerra com código != 0.
    console.error("Falha técnica ao executar o diagnóstico:");
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
