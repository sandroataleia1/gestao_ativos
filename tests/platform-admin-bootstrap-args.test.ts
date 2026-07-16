import { describe, expect, it } from "vitest";

import { parseArgValue, parseEmailArg } from "@/lib/platform-admin-bootstrap";

// Sprint SST 1.4D.1 — parsing puro dos argumentos de
// scripts/platform-admin-grant.ts / scripts/platform-admin-revoke.ts. Este
// projeto não tem infraestrutura de teste de CLI via subprocess (ver
// lib/claim-exposure-timestamp.ts) — extraído para módulo próprio pelo
// mesmo motivo.

describe("parseEmailArg", () => {
  it("extrai e normaliza (lowercase/trim) o e-mail de --email=", () => {
    expect(parseEmailArg(["--email=Usuario@Dominio.com"])).toBe("usuario@dominio.com");
    expect(parseEmailArg(["--email= usuario@dominio.com "])).toBe("usuario@dominio.com");
  });

  it("retorna null quando ausente ou vazio", () => {
    expect(parseEmailArg([])).toBeNull();
    expect(parseEmailArg(["--email="])).toBeNull();
    expect(parseEmailArg(["--outro-flag=valor"])).toBeNull();
  });
});

describe("parseArgValue", () => {
  it("extrai o valor de uma flag arbitrária", () => {
    expect(parseArgValue(["--reason=Motivo da concessão"], "reason")).toBe("Motivo da concessão");
    expect(parseArgValue(["--granted-by=admin@dominio.com"], "granted-by")).toBe("admin@dominio.com");
  });

  it("retorna null quando a flag está ausente ou vazia", () => {
    expect(parseArgValue([], "reason")).toBeNull();
    expect(parseArgValue(["--reason="], "reason")).toBeNull();
    expect(parseArgValue(["--reason=   "], "reason")).toBeNull();
  });

  it("nunca confunde flags com prefixos parecidos", () => {
    expect(parseArgValue(["--reason-extra=outro valor"], "reason")).toBeNull();
  });
});
