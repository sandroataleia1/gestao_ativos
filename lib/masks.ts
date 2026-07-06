// Máscaras de formulário para os campos de documento/contato/endereço dos
// cadastros de apoio (Fabricante, Fornecedor, Colaborador) — mesmo padrão
// de app/register/register-form.tsx (lib/phone-mask.ts): função pura,
// aplicada no onChange antes de gravar no state, nunca aceita o texto cru.
// Persistem o valor já formatado (mesma convenção já usada para
// Company.phone) — nenhum dos campos-alvo tem validação de formato
// server-side, então isso é puramente uma melhoria de UX, sem mudança de
// contrato de API.

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** CNPJ: 00.000.000/0000-00 (14 dígitos). */
export function maskCNPJ(rawValue: string): string {
  const digits = onlyDigits(rawValue).slice(0, 14);
  let result = "";
  if (digits.length > 0) result += digits.slice(0, 2);
  if (digits.length > 2) result += `.${digits.slice(2, 5)}`;
  if (digits.length > 5) result += `.${digits.slice(5, 8)}`;
  if (digits.length > 8) result += `/${digits.slice(8, 12)}`;
  if (digits.length > 12) result += `-${digits.slice(12, 14)}`;
  return result;
}

/** CPF: 000.000.000-00 (11 dígitos). */
export function maskCPF(rawValue: string): string {
  const digits = onlyDigits(rawValue).slice(0, 11);
  let result = "";
  if (digits.length > 0) result += digits.slice(0, 3);
  if (digits.length > 3) result += `.${digits.slice(3, 6)}`;
  if (digits.length > 6) result += `.${digits.slice(6, 9)}`;
  if (digits.length > 9) result += `-${digits.slice(9, 11)}`;
  return result;
}

/** CEP: 00000-000 (8 dígitos). */
export function maskCEP(rawValue: string): string {
  const digits = onlyDigits(rawValue).slice(0, 8);
  let result = digits.slice(0, 5);
  if (digits.length > 5) result += `-${digits.slice(5, 8)}`;
  return result;
}

/**
 * Telefone brasileiro flexível: fixo (DD) XXXX-XXXX (10 dígitos) ou celular
 * (DD) XXXXX-XXXX (11 dígitos) — decide o formato pela quantidade de
 * dígitos já digitados, sem exigir que seja celular (diferente do
 * maskBrazilianMobilePhone usado no cadastro da empresa, que é
 * propositalmente só-celular).
 */
export function maskBrazilianPhone(rawValue: string): string {
  const digits = onlyDigits(rawValue).slice(0, 11);
  const isMobile = digits.length > 10;
  const splitAt = isMobile ? 7 : 6;
  let result = "";
  if (digits.length > 0) result += `(${digits.slice(0, 2)}`;
  if (digits.length >= 2) result += ") ";
  if (digits.length > 2) result += digits.slice(2, splitAt);
  if (digits.length > splitAt) result += `-${digits.slice(splitAt, 11)}`;
  return result;
}

/** UF: 2 letras maiúsculas (ex.: SP). Não é bem uma "máscara" numérica, mas
 * segue o mesmo princípio de normalizar o que o usuário digita. */
export function maskUF(rawValue: string): string {
  return rawValue
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

export type MaskKey = "cnpj" | "cpf" | "cep" | "phone" | "uf";

export const MASK_FUNCTIONS: Record<MaskKey, (value: string) => string> = {
  cnpj: maskCNPJ,
  cpf: maskCPF,
  cep: maskCEP,
  phone: maskBrazilianPhone,
  uf: maskUF,
};
