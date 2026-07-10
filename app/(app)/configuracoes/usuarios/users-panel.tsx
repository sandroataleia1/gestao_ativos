"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MoreHorizontalIcon, PlusIcon, SendIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

type RoleOption = { id: string; name: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  role: RoleOption | null;
};

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

export function UsersPanel({ initialUsers, roles }: { initialUsers: UserRow[]; roles: RoleOption[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [blockTarget, setBlockTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ title: string; link: string } | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function handleUnblock(user: UserRow) {
    setIsWorking(true);
    try {
      const response = await fetch(`/api/company/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`${user.name} desbloqueado(a).`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleBlockConfirm() {
    if (!blockTarget) return;
    setIsWorking(true);
    try {
      const response = await fetch(`/api/company/users/${blockTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`${blockTarget.name} bloqueado(a).`);
      setBlockTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsWorking(true);
    try {
      const response = await fetch(`/api/company/users/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`${deleteTarget.name} excluído(a).`);
      setDeleteTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleResetPassword(user: UserRow) {
    setIsWorking(true);
    try {
      const response = await fetch(`/api/company/users/${user.id}/reset-password`, { method: "POST" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const data = await response.json();
      setLinkDialog({ title: `Link de redefinição de senha — ${user.name}`, link: data.resetLink });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setInviteOpen(true)}>
          <SendIcon />
          Convidar usuário
        </Button>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          Novo usuário
        </Button>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsers.length ? (
              initialUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={user.active ? "default" : "outline"}>
                      {user.active ? "Ativo" : "Bloqueado"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon-sm" aria-label="Ações">
                                    <MoreHorizontalIcon className="size-4" />
                                  </Button>
                                }
                              />
                            }
                          />
                          <TooltipContent>Ações</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditTarget(user)}>Editar</DropdownMenuItem>
                          {user.active ? (
                            <DropdownMenuItem variant="destructive" onClick={() => setBlockTarget(user)}>
                              Bloquear
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleUnblock(user)} disabled={isWorking}>
                              Desbloquear
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleResetPassword(user)} disabled={isWorking}>
                            Redefinir senha
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(user)}>
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>Nenhum usuário cadastrado ainda.</p>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <PlusIcon />
                      Criar o primeiro usuário
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog
        open={createOpen}
        roles={roles}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />

      <InviteUserDialog
        open={inviteOpen}
        roles={roles}
        onOpenChange={setInviteOpen}
        onSuccess={(resetLink, name) => {
          setInviteOpen(false);
          setLinkDialog({ title: `Link de convite — ${name}`, link: resetLink });
          router.refresh();
        }}
      />

      <EditUserDialog
        user={editTarget}
        roles={roles}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSuccess={() => {
          setEditTarget(null);
          router.refresh();
        }}
      />

      <AlertDialog open={Boolean(blockTarget)} onOpenChange={(open) => !open && setBlockTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear {blockTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa perde acesso ao sistema imediatamente. Pode ser desbloqueada depois a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBlockConfirm}
              disabled={isWorking}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isWorking ? "Bloqueando..." : "Bloquear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é definitiva — a conta e o acesso ao sistema são removidos e não podem ser desfeitos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isWorking}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isWorking ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(linkDialog)} onOpenChange={(open) => !open && setLinkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{linkDialog?.title}</DialogTitle>
            <DialogDescription>
              Copie e envie este link manualmente (WhatsApp, e-mail, etc.). Ele leva a pessoa a uma página para
              definir a própria senha.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={linkDialog?.link ?? ""} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!linkDialog) return;
                await navigator.clipboard.writeText(linkDialog.link);
                toast.success("Link copiado.");
              }}
            >
              Copiar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: RoleOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={Object.fromEntries(roles.map((role) => [role.id, role.name]))}
      value={value}
      onValueChange={(next) => onChange(next as string)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Selecione" />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateUserDialog({
  open,
  roles,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  roles: RoleOption[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPassword("");
      setRoleId("");
      setFormError(null);
    }
  }, [open, roles]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!roleId) {
      setFormError("Selecione um papel para o usuário.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/company/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, roleId }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success("Usuário criado.");
      onSuccess();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            Você escolhe a senha inicial agora — combine com a pessoa como ela vai recebê-la.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="create-user-name">Nome</Label>
            <Input id="create-user-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSubmitting} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-user-email">E-mail</Label>
            <Input
              id="create-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-user-password">Senha inicial</Label>
            <Input
              id="create-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              minLength={8}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>Papel</Label>
            <RoleSelect roles={roles} value={roleId} onChange={setRoleId} disabled={isSubmitting} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteUserDialog({
  open,
  roles,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  roles: RoleOption[];
  onOpenChange: (open: boolean) => void;
  onSuccess: (resetLink: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setRoleId("");
      setFormError(null);
    }
  }, [open, roles]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!roleId) {
      setFormError("Selecione um papel para o usuário.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/company/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, roleId }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const data = await response.json();
      onSuccess(data.resetLink, name);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>
            A pessoa recebe um link para escolher a própria senha — você não define a senha dela.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="invite-user-name">Nome</Label>
            <Input id="invite-user-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSubmitting} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-user-email">E-mail</Label>
            <Input
              id="invite-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>Papel</Label>
            <RoleSelect roles={roles} value={roleId} onChange={setRoleId} disabled={isSubmitting} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Convidar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  roles,
  onOpenChange,
  onSuccess,
}: {
  user: UserRow | null;
  roles: RoleOption[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRoleId(user.role?.id ?? "");
      setFormError(null);
    }
  }, [user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/company/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, roleId }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success("Usuário atualizado.");
      onSuccess();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {user?.name}</DialogTitle>
          <DialogDescription>Altere o nome e/ou o papel deste usuário na empresa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="edit-user-name">Nome</Label>
            <Input id="edit-user-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isSubmitting} required />
          </div>
          <div className="grid gap-2">
            <Label>Papel</Label>
            <RoleSelect roles={roles} value={roleId} onChange={setRoleId} disabled={isSubmitting} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
