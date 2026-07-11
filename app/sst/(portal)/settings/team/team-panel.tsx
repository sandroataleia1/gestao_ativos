"use client";

import { useState } from "react";
import { Loader2Icon, MailIcon, PlusIcon, UserCheckIcon, UserXIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type TeamRole = "OWNER" | "TECHNICIAN" | "VIEWER";

type TeamMember = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: TeamRole;
  active: boolean;
  joinedAt: string;
  isCurrentUser: boolean;
};

const ROLE_LABELS: Record<TeamRole, string> = {
  OWNER: "Proprietário",
  TECHNICIAN: "Técnico",
  VIEWER: "Consulta",
};

const ROLE_VALUES: TeamRole[] = ["OWNER", "TECHNICIAN", "VIEWER"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Mensagens de erro genéricas — nunca repassar o `error` cru da API (que já
// é amigável, mas mantemos um fallback comercial mesmo assim).
const GENERIC_ERROR = "Não foi possível concluir a ação. Tente novamente.";

export function TeamPanel({
  initialMembers,
  isOwner,
}: {
  initialMembers: TeamMember[];
  isOwner: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<TeamRole>("TECHNICIAN");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<TeamMember | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  async function refreshMembers() {
    const res = await fetch("/api/sst/team");
    if (!res.ok) return;
    const data = (await res.json()) as { members: TeamMember[] };
    setMembers(data.members);
  }

  async function handleAddSubmit() {
    setError(null);
    setAddSuccessMessage(null);
    if (!addEmail.trim()) return;

    setAddSubmitting(true);
    try {
      const res = await fetch("/api/sst/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? GENERIC_ERROR);
        return;
      }
      setAddSuccessMessage(data?.message ?? "Solicitação processada.");
      setAddEmail("");
      setAddRole("TECHNICIAN");
      await refreshMembers();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleRoleChange(member: TeamMember, newRole: TeamRole) {
    if (newRole === member.role) return;
    setError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/sst/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? GENERIC_ERROR);
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m)));
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    setError(null);
    setIsDeactivating(true);
    try {
      const res = await fetch(`/api/sst/team/${deactivateTarget.id}/deactivate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? GENERIC_ERROR);
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === deactivateTarget.id ? { ...m, active: false } : m)));
      setDeactivateTarget(null);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsDeactivating(false);
    }
  }

  async function handleReactivate(member: TeamMember) {
    setError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/sst/team/${member.id}/reactivate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? GENERIC_ERROR);
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, active: true } : m)));
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isOwner ? (
        <div className="flex justify-end">
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon />
            Adicionar usuário existente
          </Button>
        </div>
      ) : null}

      {isOwner && members.length === 1 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-8 text-center">
            <p className="font-medium">Sua equipe ainda tem só você.</p>
            <p className="text-sm text-muted-foreground">
              Adicione colegas técnicos ou de consulta que já têm conta para dividir o acompanhamento das empresas
              atendidas.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {isOwner ? <TableHead>E-mail</TableHead> : null}
              <TableHead>Papel</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Entrada</TableHead>
              {isOwner ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length ? (
              members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{member.name}</span>
                      {member.isCurrentUser ? <Badge variant="outline">Você</Badge> : null}
                    </div>
                  </TableCell>
                  {isOwner ? (
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <MailIcon className="size-3.5" />
                        {member.email}
                      </span>
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {isOwner ? (
                      <Select
                        items={ROLE_LABELS}
                        value={member.role}
                        onValueChange={(value) => handleRoleChange(member, value as TeamRole)}
                        disabled={busyId === member.id}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_VALUES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.active ? "outline" : "secondary"}>
                      {member.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>
                  {isOwner ? (
                    <TableCell>
                      <div className="flex justify-end">
                        {member.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === member.id}
                            onClick={() => setDeactivateTarget(member)}
                          >
                            <UserXIcon className="size-4" />
                            Desativar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === member.id}
                            onClick={() => handleReactivate(member)}
                          >
                            {busyId === member.id ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : (
                              <UserCheckIcon className="size-4" />
                            )}
                            Reativar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={isOwner ? 6 : 4} className="h-32 text-center">
                  <p className="text-sm text-muted-foreground">Nenhum membro na equipe ainda.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {isOwner ? (
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) {
              setAddSuccessMessage(null);
              setError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar usuário existente</DialogTitle>
              <DialogDescription>
                Informe o e-mail de uma pessoa que já tem conta na plataforma. Esta sprint não cria contas novas nem
                envia convite por e-mail — o acesso fica disponível imediatamente para quem já tem conta elegível.
              </DialogDescription>
            </DialogHeader>

            {addSuccessMessage ? (
              <Alert>
                <AlertDescription>{addSuccessMessage}</AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="add-team-email">E-mail</Label>
                  <Input
                    id="add-team-email"
                    type="email"
                    placeholder="pessoa@consultoria.com"
                    value={addEmail}
                    onChange={(event) => setAddEmail(event.target.value)}
                    disabled={addSubmitting}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="add-team-role">Papel</Label>
                  <Select items={ROLE_LABELS} value={addRole} onValueChange={(value) => setAddRole(value as TeamRole)}>
                    <SelectTrigger id="add-team-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_VALUES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <DialogFooter>
              {addSuccessMessage ? (
                <Button onClick={() => setAddOpen(false)}>Fechar</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSubmitting}>
                    Cancelar
                  </Button>
                  <Button onClick={handleAddSubmit} disabled={addSubmitting || !addEmail.trim()}>
                    {addSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
                    Adicionar
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog open={Boolean(deactivateTarget)} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.name} perderá acesso ao Portal Consultoria imediatamente, mesmo que já esteja com
              uma sessão aberta. Isso não exclui o histórico de ações realizadas por essa pessoa. Você poderá
              reativar depois, se necessário.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivateConfirm}
              disabled={isDeactivating}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeactivating ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
