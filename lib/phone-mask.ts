// Máscara de celular no padrão brasileiro: (DD) 9XXXX-XXXX — DDD (2
// dígitos) + 9 + 8 dígitos, 11 dígitos no total. Função pura (client-safe),
// usada tanto no formulário de registro quanto para validar no servidor.

/** Aplica a máscara progressivamente conforme o usuário digita —
 * `onChange` deve sempre passar o valor de volta por aqui antes de gravar
 * no state, nunca aceitar o texto digitado cru. */
export function maskBrazilianMobilePhone(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, "").slice(0, 11);
  let result = "";
  if (digits.length > 0) result += `(${digits.slice(0, 2)}`;
  if (digits.length >= 2) result += ") ";
  if (digits.length > 2) result += digits.slice(2, 7);
  if (digits.length > 7) result += `-${digits.slice(7, 11)}`;
  return result;
}

export function unmaskPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/** Celular brasileiro completo: DDD de 11 a 99 (primeiro dígito 1-9) + 9 +
 * 8 dígitos. Usado tanto na validação client-side quanto no schema Zod do
 * servidor — nenhum dos dois confia no outro. */
export function isValidBrazilianMobilePhone(value: string): boolean {
  return /^[1-9][0-9]9[0-9]{8}$/.test(unmaskPhone(value));
}
