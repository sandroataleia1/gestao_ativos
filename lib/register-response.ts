// Mapeamento puro (sem DOM/router) da resposta de sucesso de POST
// /api/register para "para onde navegar" + "que mensagem mostrar durante a
// navegação". Extraído de app/register/register-form.tsx para ser testável
// sem precisar renderizar um componente React (este projeto não tem
// ambiente jsdom/Testing Library configurado — ver vitest.config.mts,
// `environment: "node"`).
//
// Contrato atual de /api/register: toda tentativa bem-sucedida devolve
// `{ ok: true, status: "ACTIVE" }` — a claim é auto-aprovada na própria
// requisição (ver app/api/register/route.ts), então o usuário já tem
// CompanyMembership ACTIVE + papel ADMIN e pode ir direto pro Portal
// Empresa. `CLAIM_REVIEW_REQUIRED` continua mapeado abaixo só por
// compatibilidade com uma versão anterior da API (nunca mais devolvida por
// /api/register hoje) — mantém o destino seguro (página de
// acompanhamento) caso volte a existir algum caminho de aprovação manual.

export type RegisterSuccessBody = { ok?: boolean; status?: string } | null;

export type RegisterSuccessOutcome = {
  redirectTo: string;
  message: string;
};

const PENDING_REVIEW_OUTCOME: RegisterSuccessOutcome = {
  redirectTo: "/company-claim/pending",
  message: "Solicitação registrada. Redirecionando para o acompanhamento.",
};

const ACTIVE_OUTCOME: RegisterSuccessOutcome = {
  redirectTo: "/dashboard",
  message: "Conta criada. Redirecionando para o painel.",
};

/**
 * `status` desconhecido/ausente (resposta malformada, versão de API mais
 * antiga/nova que o client não conhece) sempre cai no destino mais seguro —
 * a página de acompanhamento, nunca /dashboard direto: na pior hipótese o
 * usuário vê "nenhuma solicitação encontrada" lá e é redirecionado para
 * /dashboard por aquela própria página — nunca o inverso (achar que tem
 * acesso e cair direto no Portal Empresa sem checagem nenhuma).
 */
export function resolveRegisterSuccessOutcome(data: RegisterSuccessBody): RegisterSuccessOutcome {
  switch (data?.status) {
    case "ACTIVE":
      return ACTIVE_OUTCOME;
    case "CLAIM_REVIEW_REQUIRED":
    default:
      return PENDING_REVIEW_OUTCOME;
  }
}
