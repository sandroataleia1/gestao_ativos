// Nomes que só existem porque foram criados manualmente durante sprints de
// desenvolvimento/teste deste projeto, nunca por um usuário real via
// /register, ou pelos seeds oficiais (prisma/seed.ts, prisma/seed-sst-demo.ts).
// Extraído de scripts/diagnose-company-documents.ts (Sprint SST 1.4A) para
// ser reaproveitado também por scripts/diagnose-claim-flow-exposure.ts
// (Sprint SST 1.4D.1) — nunca duplicar a lista de padrões em dois lugares.
const DEMO_NAME_PATTERNS = [
  /^Empresa Demo$/,
  /\(Demo SST\)$/,
  /^Consultoria Segura SST — Acesso ao Portal/,
  /^QA Empresa/,
  /^Empresa Teste/,
  /^Empresa Mascara Teste$/,
  /^Empresa Com Celular$/,
  /^Empresa Vazia/,
  /^Nova Empresa/,
  /^Empresa Stock/,
  /^Empresa [A-Z] Teste$/,
];

export function looksLikeDemoData(name: string): boolean {
  return DEMO_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
