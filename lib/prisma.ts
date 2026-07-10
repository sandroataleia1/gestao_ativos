import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Logging de queries só quando explicitamente pedido (PRISMA_LOG_QUERIES=true)
// — nunca em produção por padrão, usado só pelo script de profiling
// (scripts/profile.mjs) para contar/medir consultas antes/depois de uma
// otimização. Ver docs/performance.md.
const shouldLogQueries = process.env.PRISMA_LOG_QUERIES === "true";

export const prisma =
  globalForPrisma.prisma ??
  (shouldLogQueries
    ? new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] })
    : new PrismaClient({ adapter }));

if (shouldLogQueries) {
  let queryCount = 0;
  let totalDurationMs = 0;
  (prisma as unknown as { $on: (event: "query", cb: (event: { query: string; duration: number }) => void) => void }).$on(
    "query",
    (event) => {
      queryCount += 1;
      totalDurationMs += event.duration;
    },
  );
  (globalThis as unknown as { __prismaQueryStats: () => { queryCount: number; totalDurationMs: number } }).__prismaQueryStats =
    () => ({ queryCount, totalDurationMs });
  (globalThis as unknown as { __prismaQueryReset: () => void }).__prismaQueryReset = () => {
    queryCount = 0;
    totalDurationMs = 0;
  };
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
