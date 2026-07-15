import { describe, expect, it } from "vitest";

import {
  InvalidCnpjError,
  formatCnpj,
  isValidCnpj,
  maskCnpjForLog,
  normalizeCnpj,
  parseCnpj,
  withValidCheckDigits,
} from "@/lib/cnpj";

// Sprint Comercial SST 1.4 — helpers de CNPJ. "11.222.333/0001-81" é o CNPJ
// fictício mas matematicamente válido já usado como exemplo padrão em
// diversas bibliotecas de validação BR (e reaproveitado em prisma/seed.ts
// para "Empresa Demo") — usado aqui como caso de referência conhecido.
const KNOWN_VALID_MASKED = "11.222.333/0001-81";
const KNOWN_VALID_DIGITS = "11222333000181";

describe("normalizeCnpj", () => {
  it("máscara, sem máscara e com espaços normalizam para o mesmo valor", () => {
    expect(normalizeCnpj("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizeCnpj("12345678000190")).toBe("12345678000190");
    expect(normalizeCnpj("12 345 678 0001 90")).toBe("12345678000190");
  });

  it("remove qualquer caractere não-numérico", () => {
    expect(normalizeCnpj("12.345.678/0001-9a")).toBe("1234567800019");
  });

  it("devolve string vazia para entrada nula/vazia", () => {
    expect(normalizeCnpj(null)).toBe("");
    expect(normalizeCnpj(undefined)).toBe("");
    expect(normalizeCnpj("")).toBe("");
  });
});

describe("isValidCnpj", () => {
  it("aceita um CNPJ válido, mascarado ou não", () => {
    expect(isValidCnpj(KNOWN_VALID_MASKED)).toBe(true);
    expect(isValidCnpj(KNOWN_VALID_DIGITS)).toBe(true);
  });

  it("rejeita quantidade errada de dígitos", () => {
    expect(isValidCnpj("123")).toBe(false);
    expect(isValidCnpj("112223330001811")).toBe(false);
  });

  it("rejeita todas as 10 sequências de dígitos repetidos (0..9)", () => {
    for (let d = 0; d <= 9; d++) {
      expect(isValidCnpj(String(d).repeat(14))).toBe(false);
    }
  });

  it("rejeita primeiro dígito verificador inválido", () => {
    // KNOWN_VALID_DIGITS = "11222333000181" — posição 12 (0-indexed) é o
    // primeiro DV ("8"); trocar só ele para "0" quebra já o primeiro cálculo.
    expect(isValidCnpj("11222333000101")).toBe(false);
  });

  it("rejeita segundo dígito verificador inválido (primeiro OK)", () => {
    // Mesma base + primeiro DV correto ("8"), segundo DV trocado.
    expect(isValidCnpj("11222333000180")).toBe(false);
  });

  it("rejeita menos de 14 dígitos", () => {
    expect(isValidCnpj("1122233300018")).toBe(false); // 13 dígitos
    expect(isValidCnpj("123")).toBe(false);
  });

  it("rejeita mais de 14 dígitos", () => {
    expect(isValidCnpj("112223330001811")).toBe(false); // 15 dígitos
  });

  it("rejeita nulo/vazio/undefined", () => {
    expect(isValidCnpj(null)).toBe(false);
    expect(isValidCnpj(undefined)).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
});

describe("formatCnpj", () => {
  it("formata 14 dígitos como XX.XXX.XXX/XXXX-XX", () => {
    expect(formatCnpj(KNOWN_VALID_DIGITS)).toBe(KNOWN_VALID_MASKED);
  });

  it("é idempotente para um valor já mascarado", () => {
    expect(formatCnpj(KNOWN_VALID_MASKED)).toBe(KNOWN_VALID_MASKED);
  });

  it("devolve o valor original (trim) quando não há 14 dígitos — nunca mascara parcialmente um valor inválido como se fosse válido", () => {
    expect(formatCnpj("abc")).toBe("abc");
    expect(formatCnpj("  123  ")).toBe("123");
  });
});

describe("parseCnpj", () => {
  it("normaliza, valida e formata em um único passo para um CNPJ válido", () => {
    expect(parseCnpj(KNOWN_VALID_MASKED)).toEqual({ normalized: KNOWN_VALID_DIGITS, formatted: KNOWN_VALID_MASKED });
    expect(parseCnpj(KNOWN_VALID_DIGITS)).toEqual({ normalized: KNOWN_VALID_DIGITS, formatted: KNOWN_VALID_MASKED });
  });

  it("entrada externa (ex.: valor já normalizado por engano no client) não muda o resultado — servidor sempre recalcula", () => {
    const clientClaimedNormalized = "00000000000000"; // valor forjado/errado vindo do client
    expect(() => parseCnpj(clientClaimedNormalized)).toThrow(InvalidCnpjError);
    expect(parseCnpj(KNOWN_VALID_MASKED).normalized).toBe(KNOWN_VALID_DIGITS);
  });

  it("lança InvalidCnpjError para entrada inválida — nunca devolve um valor parcial", () => {
    expect(() => parseCnpj("123")).toThrow(InvalidCnpjError);
    expect(() => parseCnpj("00000000000000")).toThrow(InvalidCnpjError);
    expect(() => parseCnpj(null)).toThrow(InvalidCnpjError);
    expect(() => parseCnpj(undefined)).toThrow(InvalidCnpjError);
    expect(() => parseCnpj("")).toThrow(InvalidCnpjError);
  });
});

describe("maskCnpjForLog", () => {
  it("mantém só os 2 primeiros e 2 últimos dígitos", () => {
    expect(maskCnpjForLog(KNOWN_VALID_DIGITS)).toBe("11.***.***/****-81");
  });

  it("nunca expõe o meio do documento mesmo mascarado na entrada", () => {
    expect(maskCnpjForLog(KNOWN_VALID_MASKED)).toBe("11.***.***/****-81");
  });

  it("devolve um placeholder seguro para valor inválido", () => {
    expect(maskCnpjForLog("abc")).toBe("***");
    expect(maskCnpjForLog(null)).toBe("***");
  });
});

describe("withValidCheckDigits", () => {
  it("gera um CNPJ com dígitos verificadores válidos e determinísticos", () => {
    const generated = withValidCheckDigits("112223330001");
    expect(generated).toBe(KNOWN_VALID_DIGITS);
    expect(isValidCnpj(generated)).toBe(true);
  });

  it("é determinístico: mesma base sempre gera o mesmo CNPJ", () => {
    expect(withValidCheckDigits("000011112222")).toBe(withValidCheckDigits("000011112222"));
  });

  it("lança se a base não tiver exatamente 12 dígitos", () => {
    expect(() => withValidCheckDigits("123")).toThrow();
    expect(() => withValidCheckDigits("12345678901a")).toThrow();
  });
});
