// Helpers reutilizáveis de CNPJ (Sprint Comercial SST 1.4) — usados tanto no
// cadastro público quanto no pré-cadastro de empresa pela consultoria SST, e
// reaproveitados por scripts/diagnose-company-documents.ts (que antes tinha
// sua própria cópia do algoritmo de dígito verificador). Nenhuma chamada
// externa (Receita Federal etc.) nesta sprint — apenas validação matemática
// do dígito verificador e normalização de formato.

const CNPJ_DIGIT_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_DIGIT_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function calcCnpjCheckDigit(base: string, weights: number[]): number {
  const sum = base.split("").reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

/** Remove tudo que não for dígito. Aceita CNPJ mascarado, sem máscara, com
 * espaços, ou entrada vazia/nula — sempre devolve uma string (possivelmente
 * vazia ou com menos/mais de 14 dígitos; validar separadamente com
 * `isValidCnpj`). */
export function normalizeCnpj(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/** true se `value` normaliza para exatamente 14 dígitos, não é uma sequência
 * repetida (00000000000000, 11111111111111, ...) e os dois dígitos
 * verificadores batem com o algoritmo padrão (módulo 11). Não valida CNPJ
 * alfanumérico (regra da Receita vigente a partir de 2026) — assume o
 * formato numérico clássico. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const dv1 = calcCnpjCheckDigit(digits.slice(0, 12), CNPJ_DIGIT_WEIGHTS_1);
  if (dv1 !== Number(digits[12])) return false;
  const dv2 = calcCnpjCheckDigit(digits.slice(0, 13), CNPJ_DIGIT_WEIGHTS_2);
  return dv2 === Number(digits[13]);
}

/** Formata 14 dígitos como "XX.XXX.XXX/XXXX-XX". Se `value` não normalizar
 * para exatamente 14 dígitos, devolve a string original (trim) sem lançar —
 * quem precisa garantir validade deve chamar `isValidCnpj` antes. */
export function formatCnpj(value: string | null | undefined): string {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return (value ?? "").trim();
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

/** Versão mascarada para audit log/metadata — nunca logar o CNPJ completo
 * (ver lib/audit.ts). Mantém só os 2 primeiros e os 2 últimos dígitos. */
export function maskCnpjForLog(value: string | null | undefined): string {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return "***";
  return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12, 14)}`;
}

/** Aplica a máscara "XX.XXX.XXX/XXXX-XX" progressivamente conforme o usuário
 * digita (client-safe, sem I/O) — mesmo padrão de
 * `maskBrazilianMobilePhone` (lib/phone-mask.ts). `onChange` deve sempre
 * passar o valor de volta por aqui antes de gravar no state. Diferente de
 * `formatCnpj`, aceita entradas incompletas (menos de 14 dígitos). */
export function maskCnpjInput(rawValue: string): string {
  const digits = normalizeCnpj(rawValue).slice(0, 14);
  let result = "";
  if (digits.length > 0) result += digits.slice(0, 2);
  if (digits.length > 2) result += `.${digits.slice(2, 5)}`;
  if (digits.length > 5) result += `.${digits.slice(5, 8)}`;
  if (digits.length > 8) result += `/${digits.slice(8, 12)}`;
  if (digits.length > 12) result += `-${digits.slice(12, 14)}`;
  return result;
}

/** Constrói um CNPJ com dígitos verificadores válidos a partir de uma base de
 * 12 dígitos — usado por seeds/scripts para gerar CNPJs fictícios porém
 * matematicamente válidos e determinísticos (nunca um CNPJ real conhecido).
 * Lança se `base12` não tiver exatamente 12 dígitos numéricos. */
export function withValidCheckDigits(base12: string): string {
  if (!/^\d{12}$/.test(base12)) {
    throw new Error(`withValidCheckDigits: base precisa ter exatamente 12 dígitos, recebeu "${base12}"`);
  }
  const dv1 = calcCnpjCheckDigit(base12, CNPJ_DIGIT_WEIGHTS_1);
  const dv2 = calcCnpjCheckDigit(base12 + dv1, CNPJ_DIGIT_WEIGHTS_2);
  return `${base12}${dv1}${dv2}`;
}
