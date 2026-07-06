// Move o foco para o primeiro campo com erro depois de uma validação
// (client-side ou retorno da API) — sem isso, o usuário só via o texto de
// erro embaixo do campo e precisava achar visualmente qual input corrigir.

export function focusField(id: string) {
  // requestAnimationFrame garante que o elemento já esteja no DOM (ex.:
  // campo que só aparece condicionalmente após a validação rodar).
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) {
      element.focus();
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

/**
 * `order` é a ordem visual dos campos no formulário (nem sempre bate com a
 * ordem das chaves do objeto de erros) — o primeiro da lista que tiver
 * erro recebe o foco. `idFor` mapeia a chave do campo pro id do elemento
 * no DOM (por padrão, a própria chave).
 */
export function focusFirstFieldWithError(
  fieldErrors: Record<string, string[] | string | undefined>,
  order: string[],
  idFor: (key: string) => string = (key) => key,
) {
  const firstKey = order.find((key) => {
    const error = fieldErrors[key];
    return Array.isArray(error) ? error.length > 0 : Boolean(error);
  });
  if (firstKey) focusField(idFor(firstKey));
}
