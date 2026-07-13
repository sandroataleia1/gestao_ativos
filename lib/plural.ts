// Helper genérico de pluralização (Sprint Demo Comercial SST 1.3) — sem
// biblioteca nova, porque o projeto só precisa da regra simples do
// português (singular só para count === 1; zero e demais usam plural).
// Cada chamador passa a frase completa em cada forma (não só o substantivo)
// porque "colaborador ativo" -> "colaboradores ativos" pluraliza duas
// palavras, não uma.
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
