import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeliverySummary } from "./wizard-logic";

// Resumo lateral em desktop — Sprint Demo Comercial (Wizard de Nova
// Entrega), Parte 11. Só aparece quando já há algo relevante para mostrar
// (Parte 11: "não mostrar se ainda não houver informação") e nunca é a
// única revisão disponível — a etapa 3 sempre tem a revisão completa
// própria, este painel é um complemento, não substituto (Parte 11: "o
// resumo não deve substituir a revisão completa da etapa 3").
export function DeliverySummaryPanel({ summary }: { summary: DeliverySummary | null }) {
  if (!summary) return null;

  const rows: { label: string; value: string }[] = [{ label: "Colaborador", value: summary.employeeName }];
  if (summary.itemLabel) rows.push({ label: "Item", value: summary.itemLabel });
  if (summary.quantityOrSerial) rows.push({ label: "Quantidade", value: summary.quantityOrSerial });
  if (summary.deliveredAtLabel) rows.push({ label: "Entrega", value: summary.deliveredAtLabel });
  if (summary.expectedReturnLabel) rows.push({ label: "Previsão de devolução", value: summary.expectedReturnLabel });
  rows.push({ label: "Assinatura", value: summary.signatureModeLabel });

  return (
    <Card className="w-full max-w-72">
      <CardHeader>
        <CardTitle className="text-sm">Resumo da entrega</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-0.5">
            <p className="text-xs text-muted-foreground">{row.label}</p>
            <p className="text-sm font-medium break-words">{row.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
