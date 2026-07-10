// Script de profiling — mede tempo de resposta (parede) e nº de queries
// Prisma disparadas por página, contra o servidor rodando com
// PRISMA_LOG_QUERIES=true (ver lib/prisma.ts + app/api/debug/query-stats).
//
// Uso:
//   PRISMA_LOG_QUERIES=true npm run dev   (num terminal)
//   node scripts/profile.mjs              (noutro)
//
// Requer a empresa demo já populada com prisma/seed-bulk.ts
// (npm run db:seed:bulk) para os números refletirem escala real.

const BASE = process.env.PROFILE_BASE_URL ?? "http://localhost:3010";
const EMAIL = "admin@demo.com";
const PASSWORD = "Demo@12345";

async function login() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Referer: `${BASE}/login`,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (!setCookie.length) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login falhou (status ${res.status}). Confira email/senha da empresa demo. Body: ${body.slice(0, 300)}`);
  }
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function resetQueryStats(cookie) {
  await fetch(`${BASE}/api/debug/query-stats?reset=1`, { headers: { Cookie: cookie } });
}

async function getQueryStats(cookie) {
  const res = await fetch(`${BASE}/api/debug/query-stats`, { headers: { Cookie: cookie } });
  if (!res.ok) return { queryCount: null, totalDurationMs: null };
  return res.json();
}

async function measurePage(cookie, path, { warmup = true } = {}) {
  if (warmup) {
    await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  }
  await resetQueryStats(cookie);
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  await res.text();
  const wallMs = performance.now() - start;
  const stats = await getQueryStats(cookie);
  return { path, status: res.status, wallMs: Math.round(wallMs), ...stats };
}

async function main() {
  console.log(`Base: ${BASE}`);
  console.log("Autenticando...");
  const cookie = await login();

  const pages = [
    "/dashboard",
    "/assets",
    "/employees",
    "/stock",
    "/custodies?tab=active",
    "/custodies?tab=history",
    "/custodies?tab=overdue",
    "/cadastros/categorias",
    "/reports?tab=assets",
    "/reports?tab=stock",
    "/reports?tab=custodies",
    "/reports?tab=ca",
    "/alerts",
  ];

  console.log("\n%-28s %8s %10s %14s", "Página", "Status", "Tempo(ms)", "Queries Prisma");
  console.log("-".repeat(66));

  const results = [];
  for (const path of pages) {
    const result = await measurePage(cookie, path);
    results.push(result);
    const queryInfo =
      result.queryCount === null ? "n/d (server sem PRISMA_LOG_QUERIES)" : `${result.queryCount} (${Math.round(result.totalDurationMs)}ms no banco)`;
    console.log(
      `${result.path.padEnd(28)} ${String(result.status).padEnd(8)} ${String(result.wallMs).padEnd(10)} ${queryInfo}`,
    );
  }

  console.log("\nJSON bruto (pra colar em docs/performance.md se necessário):");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
