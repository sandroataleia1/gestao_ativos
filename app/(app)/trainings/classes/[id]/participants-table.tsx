"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddParticipantsDialog } from "./add-participants-dialog";
import type { ParticipantRow } from "./types";

const ATTENDANCE_LABELS: Record<string, string> = {
  ENROLLED: "Pendente",
  PRESENT: "Presente",
  ABSENT: "Ausente",
};

const RESULT_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  FAILED: "Reprovado",
};

function formatDate(date: Date | string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("pt-BR");
}

function isExpired(date: Date | string | null) {
  return Boolean(date && new Date(date).getTime() < Date.now());
}

export function ParticipantsTable({
  trainingClassId,
  trainingClassStatus,
  maximumParticipants,
  initialParticipants,
  canManage,
}: {
  trainingClassId: string;
  trainingClassStatus: string;
  maximumParticipants: number | null;
  initialParticipants: ParticipantRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ParticipantRow | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [notesTarget, setNotesTarget] = useState<ParticipantRow | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [pendingParticipantId, setPendingParticipantId] = useState<string | null>(null);

  // Sprint SST 1.4G, §8 — só SCHEDULED permite gestão de participantes
  // (inclusão, remoção lógica e reativação); IN_PROGRESS deixou de permitir
  // inclusão nesta sprint (era permitido antes, ver ALLOWED_STATUS.add).
  const canAdd = canManage && trainingClassStatus === "SCHEDULED";
  const canRemove = canManage && trainingClassStatus === "SCHEDULED";
  const canReactivate = canManage && trainingClassStatus === "SCHEDULED";
  const canRecord = canManage && (trainingClassStatus === "IN_PROGRESS" || trainingClassStatus === "COMPLETED");

  const activeParticipants = initialParticipants.filter((p) => p.enrollmentStatus !== "CANCELLED");

  async function updateParticipant(participantId: string, payload: Record<string, unknown>) {
    setPendingParticipantId(participantId);
    try {
      const response = await fetch(`/api/training-classes/${trainingClassId}/participants/${participantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível atualizar o participante.");
      }
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
      return false;
    } finally {
      setPendingParticipantId(null);
    }
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    setIsRemoving(true);
    try {
      const response = await fetch(
        `/api/training-classes/${trainingClassId}/participants/${removeTarget.id}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível remover o participante.");
      }
      toast.success("Participante removido.");
      setRemoveTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsRemoving(false);
    }
  }

  async function handleReactivate(participant: ParticipantRow) {
    setPendingParticipantId(participant.id);
    try {
      const response = await fetch(
        `/api/training-classes/${trainingClassId}/participants/${participant.id}/reactivate`,
        { method: "POST" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível reativar o participante.");
      }
      toast.success("Participante reativado.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setPendingParticipantId(null);
    }
  }

  async function handleSaveNotes() {
    if (!notesTarget) return;
    setIsSavingNotes(true);
    const ok = await updateParticipant(notesTarget.id, { notes: notesDraft });
    setIsSavingNotes(false);
    if (ok) {
      toast.success("Observação salva.");
      setNotesTarget(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Participantes</h2>
        {canAdd ? (
          <Button onClick={() => setAddDialogOpen(true)}>
            <PlusIcon />
            Adicionar participantes
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Documento/Matrícula</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Presença</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Conclusão</TableHead>
              <TableHead>Vencimento</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialParticipants.length ? (
              initialParticipants.map((participant) => {
                const isPending = pendingParticipantId === participant.id;
                const isCancelled = participant.enrollmentStatus === "CANCELLED";
                const isEmployeeInactive = participant.employee.status !== "ACTIVE";
                return (
                  <TableRow key={participant.id} className={isCancelled ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {participant.employee.name}
                        {isCancelled ? <Badge variant="outline">Removido</Badge> : null}
                        {isEmployeeInactive ? <Badge variant="destructive">Colaborador inativo</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {participant.employee.registration ?? participant.employee.document}
                    </TableCell>
                    <TableCell>{participant.employee.department?.name ?? "—"}</TableCell>
                    <TableCell>{participant.employee.position?.name ?? "—"}</TableCell>
                    <TableCell>
                      {isCancelled ? (
                        "—"
                      ) : canRecord ? (
                        <Select
                          items={ATTENDANCE_LABELS}
                          value={participant.attendanceStatus}
                          onValueChange={(value) =>
                            updateParticipant(participant.id, { attendanceStatus: value })
                          }
                          disabled={isPending}
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{ATTENDANCE_LABELS[participant.attendanceStatus]}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isCancelled ? (
                        "—"
                      ) : canRecord ? (
                        <Select
                          items={RESULT_LABELS}
                          value={participant.resultStatus}
                          onValueChange={(value) =>
                            updateParticipant(participant.id, { resultStatus: value })
                          }
                          disabled={isPending}
                        >
                          <SelectTrigger size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(RESULT_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
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
                      )}
                    </TableCell>
                    <TableCell>{isCancelled ? "—" : formatDate(participant.completedAt)}</TableCell>
                    <TableCell>
                      {isCancelled ? (
                        "—"
                      ) : participant.expiresAt ? (
                        <span className="flex items-center gap-1.5">
                          {formatDate(participant.expiresAt)}
                          {isExpired(participant.expiresAt) ? (
                            <Badge variant="destructive">Vencido</Badge>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <DropdownMenuTrigger
                                    render={
                                      <Button variant="ghost" size="icon-sm" aria-label="Ações" disabled={isPending}>
                                        {isPending ? (
                                          <Loader2Icon className="size-4 animate-spin" />
                                        ) : (
                                          <MoreHorizontalIcon className="size-4" />
                                        )}
                                      </Button>
                                    }
                                  />
                                }
                              />
                              <TooltipContent>Ações</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                              {isCancelled ? (
                                <DropdownMenuItem
                                  disabled={!canReactivate || isEmployeeInactive}
                                  onClick={() => handleReactivate(participant)}
                                >
                                  Reativar participante
                                </DropdownMenuItem>
                              ) : (
                                <>
                                  <DropdownMenuItem
                                    disabled={!canRecord}
                                    onClick={() => {
                                      setNotesTarget(participant);
                                      setNotesDraft(participant.notes ?? "");
                                    }}
                                  >
                                    Editar observação
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={!canRemove}
                                    onClick={() => setRemoveTarget(participant)}
                                  >
                                    Remover participante
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={canManage ? 9 : 8} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>Nenhum participante nesta turma ainda.</p>
                    {canAdd ? (
                      <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                        <PlusIcon />
                        Adicionar participantes
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AddParticipantsDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        trainingClassId={trainingClassId}
        maximumParticipants={maximumParticipants}
        currentParticipantCount={activeParticipants.length}
        onAdded={() => router.refresh()}
      />

      <Dialog open={Boolean(notesTarget)} onOpenChange={(open) => !open && setNotesTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Observação</DialogTitle>
            <DialogDescription>{notesTarget?.employee.name}</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            disabled={isSavingNotes}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNotesTarget(null)} disabled={isSavingNotes}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSaveNotes} disabled={isSavingNotes}>
              {isSavingNotes ? <Loader2Icon className="animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover participante?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.employee.name} será removido desta turma. O histórico é mantido e a inscrição pode
              ser reativada enquanto a turma estiver agendada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveConfirm}
              disabled={isRemoving}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isRemoving ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
