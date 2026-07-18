// Extraída de lib/custodies/index.ts (Sprint SST 1.4H, fatia 2) para
// reaproveitar entre módulos que geram HTML a partir de dado de banco
// (termo de custódia, lista de presença/certificado de treinamento) —
// nunca duplicar a sanitização de XSS usada em contentHtml renderizado com
// dangerouslySetInnerHTML.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
