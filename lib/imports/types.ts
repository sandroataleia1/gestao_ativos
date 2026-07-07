// Tipos compartilhados pela importação em lote (Colaboradores/Ativos/
// Estoque inicial) — ver docs/imports.md.

export type ImportEntityType = "employees" | "assets" | "stock";

export type ImportRowAction = "created" | "updated" | "skipped";

export type ImportRowResult = {
  rowNumber: number;
  status: "valid" | "error";
  // Erros de validação/negócio, já formatados pra exibir por linha (ex.:
  // "documento: Informe um documento válido.").
  errors: string[];
  // Avisos informativos, nunca bloqueiam a linha (ex.: "Categoria \"TI\" será
  // criada.").
  notes: string[];
  // Só preenchido quando dryRun = false (resultado real da gravação).
  action?: ImportRowAction;
  // Eco dos valores da linha (já com nomes resolvidos), pra tabela de preview.
  preview: Record<string, string>;
};

export type ImportSummary = {
  total: number;
  valid: number;
  withError: number;
  created: number;
  updated: number;
  skipped: number;
};

export type ImportResult = {
  summary: ImportSummary;
  rows: ImportRowResult[];
};

export function summarize(rows: ImportRowResult[]): ImportSummary {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    withError: rows.filter((row) => row.status === "error").length,
    created: rows.filter((row) => row.action === "created").length,
    updated: rows.filter((row) => row.action === "updated").length,
    skipped: rows.filter((row) => row.action === "skipped").length,
  };
}
