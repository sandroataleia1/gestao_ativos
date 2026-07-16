import { describe, expect, it } from "vitest";

import { validateExposureWindow, validateSinceTimestamp } from "@/lib/claim-exposure-timestamp";
import { classifyMembership, MEMBERSHIP_CLASSIFICATION_LABELS, type MembershipClassificationInput } from "@/lib/claim-exposure-classifier";

// Sprint SST 1.4D.1, §16, itens 1-14 — contrato do diagnóstico de exposição
// (lib/claim-exposure-timestamp.ts) e classificação de membership
// (lib/claim-exposure-classifier.ts). Puros, sem banco — mesmo padrão de
// tests/cnpj.test.ts.

const NOW = new Date("2026-07-16T00:00:00Z");
const VALID_SINCE = "2026-07-10T14:00:00-03:00";
const VALID_UNTIL = "2026-07-15T09:30:00-03:00";

describe("validateExposureWindow (§16, 1-8)", () => {
  it("1 — exige início", () => {
    const result = validateExposureWindow(undefined, VALID_UNTIL, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/INÍCIO/i);
  });

  it("2 — exige fim", () => {
    const result = validateExposureWindow(VALID_SINCE, undefined, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/FIM/i);
  });

  it("3 — rejeita início sem timezone", () => {
    const result = validateExposureWindow("2026-07-10T14:00:00", VALID_UNTIL, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/timezone/i);
  });

  it("4 — rejeita fim sem timezone", () => {
    const result = validateExposureWindow(VALID_SINCE, "2026-07-15T09:30:00", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/timezone/i);
  });

  it("5 — rejeita início posterior (ou igual) ao fim", () => {
    const result = validateExposureWindow(VALID_UNTIL, VALID_SINCE, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/anterior/i);

    const equal = validateExposureWindow(VALID_SINCE, VALID_SINCE, NOW);
    expect(equal.ok).toBe(false);
  });

  it("6 — rejeita datas futuras (início ou fim)", () => {
    const futureSince = validateExposureWindow("2099-01-01T00:00:00Z", VALID_UNTIL, NOW);
    expect(futureSince.ok).toBe(false);

    const futureUntil = validateExposureWindow(VALID_SINCE, "2099-01-01T00:00:00Z", NOW);
    expect(futureUntil.ok).toBe(false);
  });

  it("6b — rejeita ano implausivelmente antigo (typo grosseiro)", () => {
    const result = validateExposureWindow("2016-01-01T00:00:00Z", VALID_UNTIL, NOW);
    expect(result.ok).toBe(false);
  });

  it("7 — janela válida retorna since/until como Date", () => {
    const result = validateExposureWindow(VALID_SINCE, VALID_UNTIL, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.since.toISOString()).toBe(new Date(VALID_SINCE).toISOString());
    expect(result.until.toISOString()).toBe(new Date(VALID_UNTIL).toISOString());
  });

  it("8 — validateSinceTimestamp (compat) aceita um único timestamp válido", () => {
    const result = validateSinceTimestamp(VALID_SINCE, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("classifyMembership (§16, 9-12)", () => {
  const since = new Date("2026-07-10T00:00:00Z");
  const until = new Date("2026-07-15T00:00:00Z");

  function baseInput(overrides: Partial<MembershipClassificationInput> = {}): MembershipClassificationInput {
    return {
      membershipCreatedAt: new Date("2026-07-12T00:00:00Z"),
      windowSince: since,
      windowUntil: until,
      companyName: "Empresa Real LTDA",
      companyOrigin: "SELF_REGISTRATION",
      invitedByUserId: null,
      hasApprovedClaim: false,
      hasClaimStartedAuditEvent: false,
      userCreatedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("9 — classifica membership por convite (invitedByUserId preenchido) como LEGITIMATE_INVITE", () => {
    const result = classifyMembership(baseInput({ invitedByUserId: "user-123" }));
    expect(result).toBe("LEGITIMATE_INVITE");
  });

  it("10 — classifica membership por claim aprovada (hasApprovedClaim) como LEGITIMATE_CLAIM_APPROVED", () => {
    const result = classifyMembership(
      baseInput({
        hasApprovedClaim: true,
        userCreatedAt: new Date("2026-01-01T00:00:00Z"), // longe da criação da membership — não dispara o sinal de suspeita.
      }),
    );
    expect(result).toBe("LEGITIMATE_CLAIM_APPROVED");
  });

  it("11 — classifica caso suspeito: Company origin SST_PROVIDER", () => {
    const result = classifyMembership(baseInput({ companyOrigin: "SST_PROVIDER" }));
    expect(result).toBe("SUSPICIOUS_INSECURE_FLOW");
  });

  it("11b — classifica caso suspeito: usuário criado quase junto com a membership, sem claim aprovada", () => {
    const membershipCreatedAt = new Date("2026-07-12T00:00:00Z");
    const result = classifyMembership(
      baseInput({ membershipCreatedAt, userCreatedAt: new Date(membershipCreatedAt.getTime() - 5_000) }),
    );
    expect(result).toBe("SUSPICIOUS_INSECURE_FLOW");
  });

  it("11c — classifica caso suspeito: evento company.claim_started próximo à criação", () => {
    const result = classifyMembership(
      baseInput({ hasClaimStartedAuditEvent: true, userCreatedAt: new Date("2026-01-01T00:00:00Z") }),
    );
    expect(result).toBe("SUSPICIOUS_INSECURE_FLOW");
  });

  it("12 — classifica caso inconclusivo quando nenhum sinal forte se aplica", () => {
    const result = classifyMembership(baseInput());
    expect(result).toBe("INCONCLUSIVE_REVIEW_MANUALLY");
  });

  it("13 — nunca marca como suspeita uma membership anterior ao início da janela", () => {
    const result = classifyMembership(
      baseInput({ membershipCreatedAt: new Date("2026-07-01T00:00:00Z"), companyOrigin: "SST_PROVIDER" }),
    );
    expect(result).toBe("BEFORE_EXPOSURE");
  });

  it("14 — nunca marca como suspeita uma membership posterior ao fim da janela", () => {
    const result = classifyMembership(
      baseInput({ membershipCreatedAt: new Date("2026-07-20T00:00:00Z"), companyOrigin: "SST_PROVIDER" }),
    );
    expect(result).toBe("AFTER_FIX");
  });

  it("15 — classifica dado demonstrativo/seed pelo nome conhecido, mesmo dentro da janela", () => {
    const result = classifyMembership(baseInput({ companyName: "Empresa Demo", companyOrigin: "SST_PROVIDER" }));
    expect(result).toBe("SEED_OR_DEMO");
  });

  it("16 — todas as 7 categorias possuem rótulo legível (nunca undefined)", () => {
    for (const key of Object.keys(MEMBERSHIP_CLASSIFICATION_LABELS)) {
      expect(MEMBERSHIP_CLASSIFICATION_LABELS[key as keyof typeof MEMBERSHIP_CLASSIFICATION_LABELS]).toBeTruthy();
    }
  });
});
