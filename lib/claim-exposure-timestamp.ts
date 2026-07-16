// Sprint SST 1.4C.1, §10 / Sprint SST 1.4D.1, §2 — validação PURA (sem
// process.exit/console) do contrato de scripts/diagnose-claim-flow-exposure.ts.
// Extraído para um módulo próprio para ser testável sem precisar spawnar o
// script como subprocesso (este projeto não tem infraestrutura de teste de
// CLI via subprocess — ver tests/setup.ts, ambiente "node" puro).
//
// Sprint SST 1.4D.1 — o contrato mudou de "só --since" para uma JANELA
// obrigatória (--since E --until). O motivo: o plano de implantação da
// Sprint 1.4D usava (incorretamente) o timestamp do NOVO deploy seguro como
// início da janela de exposição — isso subestimaria drasticamente o período
// realmente exposto (o commit vulnerável 42fc120 pode ter ficado em produção
// dias/semanas antes da correção). A janela agora precisa ser informada
// explicitamente nas duas pontas: início = deploy real (ou o limite mais
// antigo plausível, conservador) do commit 42fc120; fim = deploy do código
// seguro (ou "agora", se o diagnóstico rodar antes da correção).

export type TimestampValidationResult = { ok: true; value: Date } | { ok: false; error: string };

const MIN_PLAUSIBLE_YEAR = 2024; // este projeto não existia antes disso — protege contra typo grosseiro (ex.: ano 2016).

/**
 * Nunca aceita um timestamp sem timezone explícita ou implausivelmente
 * antigo. `allowFuture` é usado só para validar `until` isoladamente antes
 * da comparação since<until (que produz sua própria mensagem mais
 * específica) — por padrão nenhum dos dois aceita data futura.
 */
function validateTimestamp(raw: string, now: Date, label: string): TimestampValidationResult {
  const trimmed = raw.trim();

  // Exige timezone explícita — `new Date("2026-07-14T20:34:08")` (sem Z/
  // offset) é interpretado como horário LOCAL do processo que roda o
  // script, uma fonte clássica de erro de +/- horas na fronteira exata da
  // janela. Regex aceita "...Z" ou "...+HH:mm"/"...-HH:mm".
  const hasExplicitTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (!hasExplicitTimezone) {
    return {
      ok: false,
      error:
        `${label} "${raw}" não tem timezone explícita (termine com "Z" para UTC, ou "+HH:mm"/"-HH:mm"). ` +
        `Sem isso, o valor seria interpretado no horário local da máquina que roda o script — ambíguo e perigoso.`,
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `${label} "${raw}" não é uma data ISO 8601 válida.` };
  }

  if (parsed.getUTCFullYear() < MIN_PLAUSIBLE_YEAR) {
    return {
      ok: false,
      error: `${label} "${raw}" tem ano ${parsed.getUTCFullYear()}, anterior a ${MIN_PLAUSIBLE_YEAR} — provável erro de digitação.`,
    };
  }

  if (parsed.getTime() > now.getTime()) {
    return { ok: false, error: `${label} "${raw}" está no futuro (agora: ${now.toISOString()}) — provável erro de digitação.` };
  }

  return { ok: true, value: parsed };
}

/** Mantido para compatibilidade de import — equivalente a validar um único
 * timestamp de início sem checar a janela completa. Prefira
 * `validateExposureWindow` para o contrato atual (since + until). */
export function validateSinceTimestamp(raw: string, now: Date = new Date()): TimestampValidationResult {
  return validateTimestamp(raw, now, "Timestamp de início");
}

export type ExposureWindowValidationResult =
  | { ok: true; since: Date; until: Date }
  | { ok: false; error: string };

/**
 * Valida a janela completa de exposição (§2 do spec da Sprint 1.4D.1):
 * ambos os valores são obrigatórios, ambos precisam de timezone explícita,
 * nenhum pode ser futuro, e `since` precisa ser estritamente anterior a
 * `until`. Nunca assume um default silencioso para nenhuma das duas pontas.
 */
export function validateExposureWindow(
  sinceRaw: string | undefined,
  untilRaw: string | undefined,
  now: Date = new Date(),
): ExposureWindowValidationResult {
  if (!sinceRaw) {
    return {
      ok: false,
      error: "Nenhum timestamp de INÍCIO da janela informado (nem --since=, nem CLAIM_EXPOSURE_START_AT).",
    };
  }
  if (!untilRaw) {
    return {
      ok: false,
      error: "Nenhum timestamp de FIM da janela informado (nem --until=, nem CLAIM_EXPOSURE_END_AT).",
    };
  }

  const since = validateTimestamp(sinceRaw, now, "Timestamp de início (CLAIM_EXPOSURE_START_AT/--since)");
  if (!since.ok) return since;

  const until = validateTimestamp(untilRaw, now, "Timestamp de fim (CLAIM_EXPOSURE_END_AT/--until)");
  if (!until.ok) return until;

  if (since.value.getTime() >= until.value.getTime()) {
    return {
      ok: false,
      error:
        `O início da janela (${since.value.toISOString()}) precisa ser ANTERIOR ao fim (${until.value.toISOString()}). ` +
        `Nunca use o timestamp do novo deploy seguro como início — isso subestimaria a janela real de exposição.`,
    };
  }

  return { ok: true, since: since.value, until: until.value };
}
