import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import packageJson from "@/package.json";
import { healthCheckStatusGauge } from "@/lib/metrics";

// Pública e sem checagem de permissão de propósito — é o endpoint que
// ferramentas de monitoramento externas (uptime checker, PM2, load
// balancer) usam para saber se o processo está de pé, então não pode
// depender de sessão. Não expõe nada sensível: só status do banco, versão
// do pacote, uptime do processo Node e o timestamp da checagem.
export async function GET() {
  const startedAt = Date.now();
  let databaseStatus: "ok" | "error" = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseStatus = "error";
  }

  healthCheckStatusGauge.set(databaseStatus === "ok" ? 1 : 0);

  const body = {
    status: databaseStatus === "ok" ? "ok" : "degraded",
    banco: databaseStatus,
    versao: packageJson.version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latenciaBancoMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, { status: databaseStatus === "ok" ? 200 : 503 });
}
