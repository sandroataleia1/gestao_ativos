// Sprint SST 1.4C.1, §10 — validação PURA (sem process.exit/console) do
// timestamp obrigatório de scripts/diagnose-claim-flow-exposure.ts.
// Extraído para um módulo próprio para ser testável sem precisar spawnar o
// script como subprocesso (este projeto não tem infraestrutura de teste de
// CLI via subprocess — ver tests/setup.ts, ambiente "node" puro).

export type SinceValidationResult = { ok: true; value: Date } | { ok: false; error: string };

const MIN_PLAUSIBLE_YEAR = 2024; // este projeto não existia antes disso — protege contra typo grosseiro (ex.: ano 2016).

/**
 * Nunca aceita um timestamp sem timezone explícita, no futuro, ou
 * implausivelmente antigo — cada uma dessas falhas produziria um
 * `CLAIM_EXPOSURE_START_AT` que faz o diagnóstico de exposição rodar com
 * uma janela errada (o pior caso é um falso negativo: memberships
 * suspeitas fora da janela verificada simplesmente não apareceriam).
 */
export function validateSinceTimestamp(raw: string, now: Date = new Date()): SinceValidationResult {
  const trimmed = raw.trim();

  // Exige timezone explícita — `new Date("2026-07-14T20:34:08")` (sem Z/
  // offset) é interpretado como horário LOCAL do processo que roda o
  // script, uma fonte clássica de erro de +/- horas na fronteira exata da
  // exposição. Regex aceita "...Z" ou "...+HH:mm"/"...-HH:mm".
  const hasExplicitTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (!hasExplicitTimezone) {
    return {
      ok: false,
      error:
        `Timestamp "${raw}" não tem timezone explícita (termine com "Z" para UTC, ou "+HH:mm"/"-HH:mm"). ` +
        `Sem isso, o valor seria interpretado no horário local da máquina que roda o script — ambíguo e perigoso.`,
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `Timestamp "${raw}" não é uma data ISO 8601 válida.` };
  }

  if (parsed.getTime() > now.getTime()) {
    return { ok: false, error: `Timestamp "${raw}" está no futuro (agora: ${now.toISOString()}) — provável erro de digitação.` };
  }
  if (parsed.getUTCFullYear() < MIN_PLAUSIBLE_YEAR) {
    return {
      ok: false,
      error: `Timestamp "${raw}" tem ano ${parsed.getUTCFullYear()}, anterior a ${MIN_PLAUSIBLE_YEAR} — provável erro de digitação.`,
    };
  }

  return { ok: true, value: parsed };
}
