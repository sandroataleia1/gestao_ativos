import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { isValidCnpj, maskCnpjForLog, normalizeCnpj } from "@/lib/cnpj";

/**
 * Diagnóstico SOMENTE-LEITURA dos documentos (CNPJ) das empresas — campo
 * legado `Company.document` e os campos canônicos `documentType`/
 * `documentOriginal`/`documentNormalized` (Sprint SST 1.4A, §8).
 *
 * Objetivo: dar visibilidade completa do estado atual dos documentos ANTES
 * de qualquer decisão sobre constraint/migration adicional. Este script
 * NUNCA escreve no banco: não faz update, insert, delete nem migração. É
 * seguro rodar em qualquer ambiente (dev/homolog/prod).
 *
 * Nunca imprime o CNPJ completo (§17/§8 — "nunca registrar CNPJ integral em
 * logs comuns") — toda linha de detalhe usa `maskCnpjForLog` (mantém só os
 * 2 primeiros e 2 últimos dígitos, mascarando o resto), mesmo na saída --json.
 *
 * Uso:
 *   npx tsx scripts/diagnose-company-documents.ts              # saída legível
 *   npx tsx scripts/diagnose-company-documents.ts --json       # saída JSON
 *   npm run diagnose:documents                                  # atalho (package.json)
 *   npm run diagnose:company-documents                          # alias (Sprint SST 1.4A, §8)
 *   npm run diagnose:documents -- --json
 *
 * Código de saída:
 *   0  -> execução bem-sucedida (mesmo que encontre dados inválidos/duplicados)
 *   1  -> erro TÉCNICO (ex.: falha de conexão com o banco)
 *
 * Encontrar documentos inválidos NÃO é erro técnico — é justamente o
 * resultado esperado do diagnóstico, então o processo encerra com 0.
 */

// --- Classificação de dado demonstrativo -------------------------------------
// Mesmos padrões de scripts/backfill-company-documents.ts — nomes que só
// existem porque foram criados manualmente durante sprints de
// desenvolvimento/teste deste projeto, nunca por um usuário real via
// /register, ou pelos seeds oficiais (prisma/seed.ts, prisma/seed-sst-demo.ts).
const DEMO_NAME_PATTERNS = [
  /^Empresa Demo$/,
  /\(Demo SST\)$/,
  /^Consultoria Segura SST — Acesso ao Portal/,
  /^QA Empresa/,
  /^Empresa Teste/,
  /^Empresa Mascara Teste$/,
  /^Empresa Com Celular$/,
  /^Empresa Vazia/,
  /^Nova Empresa/,
  /^Empresa Stock/,
  /^Empresa [A-Z] Teste$/,
];

function looksLikeDemoData(name: string): boolean {
  return DEMO_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

// --- Utilidades puras (sem I/O) ---------------------------------------------
// Normalização/validação de dígito verificador reaproveitadas de
// lib/cnpj.ts (Sprint Comercial SST 1.4) — antes duplicadas aqui.

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
  const stripped = value.replace(/\d/g, "").replace(/[.\-/\s]/g, "");
  return stripped.length > 0;
}

// --- Tipos do relatório ------------------------------------------------------

type CompanyRow = {
  id: string;
  name: string;
  document: string | null;
  documentType: string | null;
  documentOriginal: string | null;
  documentNormalized: string | null;
};

/** Versão da linha segura para exibir/serializar — nunca o CNPJ completo. */
type MaskedCompanyRow = {
  id: string;
  name: string;
  documentMasked: string;
  documentTypeSet: boolean;
};

function maskRow(c: CompanyRow): MaskedCompanyRow {
  return {
    id: c.id,
    name: c.name,
    documentMasked: maskCnpjForLog(c.document),
    documentTypeSet: c.documentType !== null,
  };
}

type ConflictGroup = {
  keyMasked: string;
  companies: MaskedCompanyRow[];
};

type Report = {
  generatedAt: string;
  database: string; // host/porta/banco, SEM usuário/senha (nunca logar segredo)
  totals: {
    totalCompanies: number;
    withoutDocument: number;
    withoutDocumentType: number;
    validCnpj: number;
    invalidCnpj: number;
    withMask: number;
    withoutMask: number;
    withNonNumericChars: number;
    wrongDigitCount: number;
    invalidCheckDigits: number;
    fieldDivergence: number;
    exactDuplicateGroups: number;
    normalizedDuplicateGroups: number;
    likelyDemoData: number;
    likelyNotDemoData: number;
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

function buildReport(companies: CompanyRow[]) {
  const withoutDocument: CompanyRow[] = [];
  const withoutDocumentType: CompanyRow[] = [];
  const validCnpj: CompanyRow[] = [];
  const invalidCnpj: CompanyRow[] = [];
  const withMask: CompanyRow[] = [];
  const withoutMask: CompanyRow[] = [];
  const withNonNumericChars: CompanyRow[] = [];
  const wrongDigitCount: CompanyRow[] = [];
  const invalidCheckDigits: CompanyRow[] = [];
  const fieldDivergence: CompanyRow[] = [];
  const likelyDemoData: CompanyRow[] = [];
  const likelyNotDemoData: CompanyRow[] = [];

  const exactMap = new Map<string, CompanyRow[]>();
  const normalizedMap = new Map<string, CompanyRow[]>();

  for (const company of companies) {
    const raw = (company.document ?? "").trim();

    if (looksLikeDemoData(company.name)) likelyDemoData.push(company);
    else likelyNotDemoData.push(company);

    if (company.documentType === null) withoutDocumentType.push(company);

    // Divergência entre document/documentOriginal/documentNormalized —
    // qualquer inconsistência entre os três indica que o backfill/criação
    // não sincronizou os campos corretamente.
    if (company.documentType !== null) {
      const normalizedFromOriginal = normalizeCnpj(company.documentOriginal);
      const divergesFromLegacy = raw !== "" && company.documentOriginal !== null && raw !== company.documentOriginal;
      const divergesNormalized =
        company.documentNormalized !== null && normalizedFromOriginal !== company.documentNormalized;
      const missingCanonicalFields = company.documentOriginal === null || company.documentNormalized === null;
      if (divergesFromLegacy || divergesNormalized || missingCanonicalFields) {
        fieldDivergence.push(company);
      }
    }

    if (raw === "") {
      withoutDocument.push(company);
      continue; // vazio não participa das demais checagens nem de duplicidade
    }

    if (hasMaskChars(raw)) withMask.push(company);
    else withoutMask.push(company);
    if (hasUnexpectedChars(raw)) withNonNumericChars.push(company);

    const digits = normalizeCnpj(raw);
    if (digits.length !== 14) {
      wrongDigitCount.push(company);
      invalidCnpj.push(company);
    } else if (!isValidCnpj(digits)) {
      invalidCheckDigits.push(company);
      invalidCnpj.push(company);
    } else {
      validCnpj.push(company);
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
      .map(([key, rows]) => ({ keyMasked: maskCnpjForLog(key), companies: rows.map(maskRow) }))
      .sort((a, b) => b.companies.length - a.companies.length);

  const exactDuplicates = toGroups(exactMap);
  const normalizedDuplicates = toGroups(normalizedMap);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    database: describeDatabaseTarget(),
    totals: {
      totalCompanies: companies.length,
      withoutDocument: withoutDocument.length,
      withoutDocumentType: withoutDocumentType.length,
      validCnpj: validCnpj.length,
      invalidCnpj: invalidCnpj.length,
      withMask: withMask.length,
      withoutMask: withoutMask.length,
      withNonNumericChars: withNonNumericChars.length,
      wrongDigitCount: wrongDigitCount.length,
      invalidCheckDigits: invalidCheckDigits.length,
      fieldDivergence: fieldDivergence.length,
      exactDuplicateGroups: exactDuplicates.length,
      normalizedDuplicateGroups: normalizedDuplicates.length,
      likelyDemoData: likelyDemoData.length,
      likelyNotDemoData: likelyNotDemoData.length,
    },
    exactDuplicates,
    normalizedDuplicates,
  };

  const details = {
    withoutDocument: withoutDocument.map(maskRow),
    withoutDocumentType: withoutDocumentType.map(maskRow),
    invalidCnpj: invalidCnpj.map(maskRow),
    fieldDivergence: fieldDivergence.map(maskRow),
    likelyDemoData: likelyDemoData.map(maskRow),
    likelyNotDemoData: likelyNotDemoData.map(maskRow),
  };

  return { report, details };
}

// --- Renderização ------------------------------------------------------------

function fmtCompany(c: MaskedCompanyRow): string {
  return `  - ${c.id}  |  ${c.name}  |  ${c.documentMasked}${c.documentTypeSet ? "" : "  (documentType ausente)"}`;
}

function renderHuman(report: Report, details: Record<string, MaskedCompanyRow[]>): string {
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
  lines.push(`  Sem documentType ................................ ${t.withoutDocumentType}`);
  lines.push(`  CNPJ válido ...................................... ${t.validCnpj}`);
  lines.push(`  CNPJ inválido .................................... ${t.invalidCnpj}`);
  lines.push(`    (dos quais com quantidade != 14 dígitos) ...... ${t.wrongDigitCount}`);
  lines.push(`    (dos quais com dígitos verificadores errados) . ${t.invalidCheckDigits}`);
  lines.push(`  Documento com máscara ............................ ${t.withMask}`);
  lines.push(`  Documento sem máscara ............................ ${t.withoutMask}`);
  lines.push(`  Com caracteres não-numéricos inesperados ........ ${t.withNonNumericChars}`);
  lines.push(`  Divergência entre document/documentOriginal/documentNormalized . ${t.fieldDivergence}`);
  lines.push(`  Grupos de duplicidade exata ..................... ${t.exactDuplicateGroups}`);
  lines.push(`  Grupos de duplicidade após normalização ......... ${t.normalizedDuplicateGroups}`);
  lines.push(`  Possível dado demonstrativo ...................... ${t.likelyDemoData}`);
  lines.push(`  Possível dado NÃO demonstrativo (revisar manualmente se algo aqui for inválido) . ${t.likelyNotDemoData}`);
  lines.push("");

  const section = (title: string, rows: MaskedCompanyRow[]) => {
    if (rows.length === 0) return;
    lines.push(`${title} (${rows.length}):`);
    for (const row of rows) lines.push(fmtCompany(row));
    lines.push("");
  };

  section("Empresas SEM documento", details.withoutDocument);
  section("Empresas SEM documentType", details.withoutDocumentType);
  section("Empresas com CNPJ inválido", details.invalidCnpj);
  section("Empresas com divergência entre campos documentais", details.fieldDivergence);

  if (report.exactDuplicates.length > 0) {
    lines.push(`Duplicidades EXATAS (mesmo valor cru) — ${report.exactDuplicates.length} grupo(s):`);
    for (const group of report.exactDuplicates) {
      lines.push(`  valor "${group.keyMasked}" aparece ${group.companies.length}x:`);
      for (const row of group.companies) lines.push(fmtCompany(row));
    }
    lines.push("");
  }

  if (report.normalizedDuplicates.length > 0) {
    lines.push(
      `Duplicidades APÓS NORMALIZAÇÃO (mesmos 14 dígitos) — ${report.normalizedDuplicates.length} grupo(s):`,
    );
    for (const group of report.normalizedDuplicates) {
      lines.push(`  dígitos "${group.keyMasked}" aparecem ${group.companies.length}x:`);
      for (const row of group.companies) lines.push(fmtCompany(row));
    }
    lines.push("");
  }

  lines.push("Nenhum dado foi modificado. Diagnóstico somente-leitura. CNPJ sempre mascarado acima.");
  return lines.join("\n");
}

// --- Entrypoint --------------------------------------------------------------

async function main() {
  const asJson = process.argv.includes("--json");

  const companies = await prisma.company.findMany({
    select: { id: true, name: true, document: true, documentType: true, documentOriginal: true, documentNormalized: true },
    orderBy: { createdAt: "asc" },
  });

  const { report, details } = buildReport(companies);

  if (asJson) {
    // Mesmo no JSON, todo CNPJ é mascarado — nunca o valor completo (§17).
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          database: report.database,
          totals: report.totals,
          details,
          exactDuplicates: report.exactDuplicates,
          normalizedDuplicates: report.normalizedDuplicates,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderHuman(report, details));
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
