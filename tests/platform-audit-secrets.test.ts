import { describe, expect, it } from "vitest";

import { assertNoSecrets } from "@/lib/platform-audit";

// Sprint SST 1.4D.1, §16, item 25 — "logs não contêm segredo". Heurística
// best-effort (mesmo espírito de reviewNoteSchema em
// lib/validations/platform-admin.ts) usada por logPlatformAudit antes de
// persistir `reason`/`metadata`.

describe("assertNoSecrets", () => {
  it("nunca lança para metadata inofensivo", () => {
    expect(() => assertNoSecrets({ since: "2026-07-10T00:00:00Z", until: "2026-07-15T00:00:00Z" })).not.toThrow();
    expect(() => assertNoSecrets(null)).not.toThrow();
    expect(() => assertNoSecrets(undefined)).not.toThrow();
    expect(() => assertNoSecrets("motivo comum, sem nada sensível")).not.toThrow();
  });

  it("lança quando uma CHAVE do metadata parece um segredo", () => {
    expect(() => assertNoSecrets({ password: "abc12345" })).toThrow(/segredo/i);
    expect(() => assertNoSecrets({ token: "xyz" })).toThrow();
    expect(() => assertNoSecrets({ cookie: "session=abc" })).toThrow();
    expect(() => assertNoSecrets({ nested: { sessionToken: "abc" } })).toThrow();
  });

  it("lança quando um VALOR string contém padrão de senha/token", () => {
    expect(() => assertNoSecrets("confirmado, senha: abc12345")).toThrow();
    expect(() => assertNoSecrets({ note: "token: abc12345" })).toThrow();
  });

  it("percorre arrays recursivamente", () => {
    expect(() => assertNoSecrets([{ ok: true }, { password: "x" }])).toThrow();
  });
});
