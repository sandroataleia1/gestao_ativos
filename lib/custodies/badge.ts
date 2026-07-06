// Este arquivo é importado por Client Components (tabelas de /custodies)
// para calcular o atraso no browser — por isso não pode ter NENHUM import em
// runtime de código server-only (Prisma client, lib/auth-server,
// lib/api-errors etc.). A parte server-only (helpers de local, indicadores)
// fica em lib/custodies/index.ts.

type CustodyForOverdue = {
  status: string;
  expectedReturnAt: string | Date | null;
};

/**
 * "Atrasado" não é um status persistido (só existem ACTIVE/RETURNED no
 * banco) — é derivado aqui, mesmo critério usado para o badge de CA em
 * lib/certifications/badge.ts: custódia ainda ativa com previsão de
 * devolução no passado.
 */
export function isCustodyOverdue(custody: CustodyForOverdue): boolean {
  if (custody.status !== "ACTIVE" || !custody.expectedReturnAt) return false;
  const expected =
    custody.expectedReturnAt instanceof Date
      ? custody.expectedReturnAt
      : new Date(custody.expectedReturnAt);
  return expected.getTime() < Date.now();
}
