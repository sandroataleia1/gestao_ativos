import { NextResponse } from "next/server";

// Exposto SÓ quando PRISMA_LOG_QUERIES=true (nunca em produção por padrão —
// ver lib/prisma.ts) — usado por scripts/profile.mjs para contar/medir
// quantas queries Prisma uma rota disparou, sem precisar instrumentar cada
// rota manualmente. `reset=1` zera os contadores (chamado antes de cada
// medição isolada).
export async function GET(request: Request) {
  if (process.env.PRISMA_LOG_QUERIES !== "true") {
    return NextResponse.json({ error: "Não disponível." }, { status: 404 });
  }

  const getStats = (globalThis as unknown as {
    __prismaQueryStats?: () => { queryCount: number; totalDurationMs: number };
  }).__prismaQueryStats;
  const stats = getStats ? getStats() : { queryCount: 0, totalDurationMs: 0 };

  const url = new URL(request.url);
  if (url.searchParams.get("reset") === "1") {
    (globalThis as unknown as { __prismaQueryReset?: () => void }).__prismaQueryReset?.();
  }

  return NextResponse.json(stats);
}
