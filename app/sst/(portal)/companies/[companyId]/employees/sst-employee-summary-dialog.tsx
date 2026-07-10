"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const RESULT_LABELS: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovado", FAILED: "Reprovado" };

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("pt-BR");
}

function isExpired(date: string | null) {
  return Boolean(date && new Date(date).getTime() < Date.now());
}

type SummaryParticipant = {
  id: string;
  resultStatus: string;
  completedAt: string | null;
  expiresAt: string | null;
  trainingClass: { title: string; startsAt: string; companyTraining: { title: string; mandatory: boolean } };
};

// Fetch sob demanda (só quando o dialog abre) — mantém a listagem paginada
// enxuta, sem carregar o histórico completo de treinamento de cada
// colaborador na tabela.
export function SstEmployeeSummaryDialog({
  companyId,
  employee,
  onOpenChange,
}: {
  companyId: string;
  employee: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [participants, setParticipants] = useState<SummaryParticipant[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Não reseta `participants` quando `employee` vira null (dialog
    // fechando) — o conteúdo já está oculto (`open={Boolean(employee)}`) e
    // a próxima seleção reaproveita o mesmo efeito, que já reinicia
    // isLoading/error/participants antes do fetch.
    if (!employee) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setParticipants(null);
    fetch(`/api/sst/companies/${companyId}/employees/${employee.id}/trainings`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar os treinamentos do colaborador.");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setParticipants(data.participants);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro inesperado.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, employee]);

  return (
    <Dialog open={Boolean(employee)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resumo de treinamentos</DialogTitle>
          <DialogDescription>{employee?.name}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : participants && participants.length ? (
          <ul className="grid max-h-96 gap-2 overflow-y-auto text-sm">
            {participants.map((participant) => (
              <li key={participant.id} className="grid gap-1 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    {participant.trainingClass.companyTraining.title}
                    {participant.trainingClass.companyTraining.mandatory ? (
                      <Badge variant="outline" className="text-xs">
                        Obrigatório
                      </Badge>
                    ) : null}
                  </span>
                  <Badge
                    variant={
                      participant.resultStatus === "APPROVED"
                        ? "default"
                        : participant.resultStatus === "FAILED"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {RESULT_LABELS[participant.resultStatus]}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Turma: {participant.trainingClass.title}</span>
                  <span>Conclusão: {formatDate(participant.completedAt)}</span>
                  <span className="flex items-center gap-1.5">
                    Vencimento: {formatDate(participant.expiresAt)}
                    {isExpired(participant.expiresAt) ? (
                      <Badge variant="destructive" className="text-xs">
                        Vencido
                      </Badge>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum treinamento registrado para este colaborador.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
