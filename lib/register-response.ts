// Sprint SST 1.4C.1 — mapeamento puro (sem DOM/router) da resposta de
// sucesso de POST /api/register para "para onde navegar" + "que mensagem
// mostrar durante a navegação". Extraído de app/register/register-form.tsx
// para ser testável sem precisar renderizar um componente React (este
// projeto não tem ambiente jsdom/Testing Library configurado — ver
// vitest.config.mts, `environment: "node"`).
//
// Contrato atual de /api/register (Sprint SST 1.4C): toda tentativa
// bem-sucedida — CNPJ novo, CNPJ de empresa UNCLAIMED, ou reivindicação
// concorrente que virou DISPUTED — devolve sempre
// `{ ok: true, status: "CLAIM_REVIEW_REQUIRED" }`. Nunca mais concede
// acesso direto ao Portal Empresa a partir do registro; o único destino
// seguro é a página de acompanhamento, nunca /dashboard.

export type RegisterSuccessBody = { ok?: boolean; status?: string } | null;

export type RegisterSuccessOutcome = {
  redirectTo: string;
  message: string;
};

const DEFAULT_OUTCOME: RegisterSuccessOutcome = {
  redirectTo: "/company-claim/pending",
  message: "Solicitação registrada. Redirecionando para o acompanhamento.",
};

/**
 * Nunca retorna `/dashboard` — mesmo para um `status` desconhecido/ausente
 * (resposta malformada, versão de API mais nova que o client ainda não
 * conhece), o destino mais seguro é sempre a página de acompanhamento:
 * na pior hipótese o usuário vê "nenhuma solicitação encontrada" lá e é
 * redirecionado para /dashboard por aquela própria página — nunca o
 * inverso (achar que tem acesso e cair direto no Portal Empresa).
 */
export function resolveRegisterSuccessOutcome(data: RegisterSuccessBody): RegisterSuccessOutcome {
  switch (data?.status) {
    case "CLAIM_REVIEW_REQUIRED":
    default:
      return DEFAULT_OUTCOME;
  }
}
