import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

// Carrega variáveis de ambiente para os testes. Preferimos `.env.test` (banco
// de testes dedicado) quando presente; caso contrário caímos no `.env` normal
// — o que é justamente o cenário que o guard abaixo existe para bloquear com
// uma mensagem clara, em vez de deixar os testes rodarem silenciosamente
// contra o banco de desenvolvimento compartilhado.
if (existsSync(".env.test")) {
  loadEnv({ path: ".env.test" });
} else {
  loadEnv();
}

// ============================================================================
// GUARD DE SEGURANÇA — impede que os testes de integração (tests/**) rodem
// contra qualquer banco que não seja um banco de testes dedicado.
//
// Os testes em tests/tenant-isolation/** criam e removem dados reais via
// Prisma (fixtures prefixadas com "__tenant_test__", nunca truncam tabelas —
// ver tests/helpers/db.ts). Mesmo sendo autolimpos, rodar contra o banco de
// desenvolvimento compartilhado é perigoso: uma falha no meio da suíte (ex.:
// processo morto, teste que lança antes do afterAll) deixa fixtures órfãs
// misturadas com dados reais, e uma execução acidental contra produção seria
// catastrófica.
//
// Todas as condições abaixo precisam ser satisfeitas para os testes rodarem:
//   1. NODE_ENV === "test"                              (definido pelo Vitest)
//   2. DATABASE_URL está definido
//   3. ALLOW_INTEGRATION_TEST_DATABASE === "true"        (opt-in explícito)
//   4. o nome do banco indica claramente ser um banco de testes
//   5. a URL não é uma URL de desenvolvimento/produção conhecida
// ============================================================================

// Nome de banco usado tanto em `.env`/`.env.example` (dev local) quanto em
// `POSTGRES_DB` de `.env.production.example` (produção) — nunca um nome
// válido de banco de testes, mesmo que o host/porta sejam diferentes.
const KNOWN_NON_TEST_DATABASE_NAMES = new Set(["gestao_ativos"]);

// Connection string literal de desenvolvimento (.env / .env.example) — bloqueio
// explícito e redundante ao check de nome, para o caso de alguém apontar um
// `DATABASE_URL` com esse valor exato mesmo sem usar `.env.test`.
const KNOWN_NON_TEST_DATABASE_URLS = new Set([
  "postgresql://postgres:postgres@localhost:5433/gestao_ativos?schema=public",
]);

function parseDatabaseUrl(raw: string): { dbName: string } | null {
  try {
    const url = new URL(raw);
    return { dbName: url.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

function assertSafeTestDatabase(): void {
  const reasons: string[] = [];

  if (process.env.NODE_ENV !== "test") {
    reasons.push(
      `NODE_ENV é "${process.env.NODE_ENV ?? "(vazio)"}", mas os testes só podem rodar com NODE_ENV=test ` +
        `(o Vitest já define isso automaticamente — se você está vendo isso, algo sobrescreveu o valor).`,
    );
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    reasons.push(
      "DATABASE_URL não está definido. Configure `.env.test` (copie de `.env.test.example`) apontando " +
        "para um banco de testes dedicado.",
    );
  }

  if (process.env.ALLOW_INTEGRATION_TEST_DATABASE !== "true") {
    reasons.push(
      'ALLOW_INTEGRATION_TEST_DATABASE não é "true". É um opt-in explícito e obrigatório: defina ' +
        'ALLOW_INTEGRATION_TEST_DATABASE="true" em `.env.test` para confirmar que você revisou qual ' +
        "banco os testes vão usar.",
    );
  }

  if (rawUrl) {
    if (KNOWN_NON_TEST_DATABASE_URLS.has(rawUrl)) {
      reasons.push(
        "DATABASE_URL é idêntico à connection string de desenvolvimento conhecida (`.env`/`.env.example`) " +
          "— os testes recusam rodar contra o banco compartilhado de dev.",
      );
    }

    const parsed = parseDatabaseUrl(rawUrl);
    if (!parsed) {
      reasons.push(`DATABASE_URL não pôde ser interpretado como uma connection string válida: "${rawUrl}".`);
    } else {
      const { dbName } = parsed;

      if (KNOWN_NON_TEST_DATABASE_NAMES.has(dbName.toLowerCase())) {
        reasons.push(
          `O nome do banco ("${dbName}") é o nome conhecido do banco de desenvolvimento/produção (usado em ` +
            "`.env` e em `POSTGRES_DB` de `.env.production.example`) — nunca rode testes de integração contra ele.",
        );
      } else if (!/(^|[_-])tests?(ing)?([_-]|$)/i.test(dbName)) {
        reasons.push(
          `O nome do banco ("${dbName}") não indica claramente que é um banco de testes (esperado algo como ` +
            '"..._test" ou "..._testing"). Aponte DATABASE_URL para um banco dedicado de testes.',
        );
      }
    }
  }

  if (reasons.length === 0) return;

  throw new Error(
    [
      "",
      "=".repeat(78),
      "BLOQUEADO: guard de segurança do banco de testes impediu a execução.",
      "=".repeat(78),
      "",
      "Os testes de integração (tests/tenant-isolation/**) criam e removem dados",
      "reais via Prisma e só podem rodar contra um banco de testes DEDICADO —",
      "nunca contra o banco de desenvolvimento ou produção compartilhado.",
      "",
      "Motivo(s):",
      ...reasons.map((r) => `  - ${r}`),
      "",
      "Como corrigir:",
      "  1. cp .env.test.example .env.test",
      "  2. Em .env.test, aponte DATABASE_URL para um Postgres/banco vazio cujo",
      '     nome contenha "test" (ex.: gestao_ativos_test).',
      '  3. Em .env.test, defina ALLOW_INTEGRATION_TEST_DATABASE="true".',
      "  4. Aplique o schema nesse banco: DATABASE_URL=<do .env.test> npx prisma db push",
      "  5. npm test",
      "=".repeat(78),
    ].join("\n"),
  );
}

assertSafeTestDatabase();
