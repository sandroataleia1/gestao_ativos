"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
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

type ProviderLinkStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
type ProviderAccessLevel = "VIEW" | "OPERATION" | "ADMINISTRATION";

type ProviderLinkRow = {
  id: string;
  status: ProviderLinkStatus;
  accessLevel: ProviderAccessLevel;
  createdAt: string;
  provider: { id: string; name: string; document: string | null; email: string | null; phone: string | null };
};

const STATUS_LABELS: Record<ProviderLinkStatus, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  REVOKED: "Revogado",
};

const STATUS_BADGE_VARIANT: Record<ProviderLinkStatus, "default" | "outline" | "secondary" | "destructive"> = {
  PENDING: "outline",
  ACTIVE: "default",
  SUSPENDED: "secondary",
  REVOKED: "destructive",
};

const ACCESS_LEVEL_LABELS: Record<ProviderAccessLevel, string> = {
  VIEW: "Visualização",
  OPERATION: "Operação",
  ADMINISTRATION: "Administração",
};

async function parseErrorMessage(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error ?? "Não foi possível concluir a ação.";
}

export function SstProvidersPanel({
  initialLinks,
  canManage,
}: {
  initialLinks: ProviderLinkRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<ProviderLinkRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ProviderLinkRow | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function updateStatus(id: string, status: Exclude<ProviderLinkStatus, "PENDING">) {
    const response = await fetch(`/api/sst-providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response));
  }

  async function handleAuthorize(link: ProviderLinkRow) {
    setIsWorking(true);
    try {
      await updateStatus(link.id, "ACTIVE");
      toast.success(`${link.provider.name} autorizado.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleSuspendConfirm() {
    if (!suspendTarget) return;
    setIsWorking(true);
    try {
      await updateStatus(suspendTarget.id, "SUSPENDED");
      toast.success(`${suspendTarget.provider.name} suspenso.`);
      setSuspendTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    setIsWorking(true);
    try {
      await updateStatus(revokeTarget.id, "REVOKED");
      toast.success(`${revokeTarget.provider.name} revogado.`);
      setRevokeTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="grid gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            Novo prestador
          </Button>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Nível de acesso</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLinks.length ? (
              initialLinks.map((link) => (
                <TableRow key={link.id}>
                  <TableCell>{link.provider.name}</TableCell>
                  <TableCell>{link.provider.document ?? "—"}</TableCell>
                  <TableCell>{link.provider.email ?? link.provider.phone ?? "—"}</TableCell>
                  <TableCell>{ACCESS_LEVEL_LABELS[link.accessLevel]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[link.status]}>{STATUS_LABELS[link.status]}</Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {link.status === "REVOKED" ? null : (
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <DropdownMenuTrigger
                                    render={
                                      <Button variant="ghost" size="icon-sm" aria-label="Ações" disabled={isWorking}>
                                        <MoreHorizontalIcon className="size-4" />
                                      </Button>
                                    }
                                  />
                                }
                              />
                              <TooltipContent>Ações</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                              {link.status === "PENDING" || link.status === "SUSPENDED" ? (
                                <DropdownMenuItem onClick={() => handleAuthorize(link)} disabled={isWorking}>
                                  Autorizar
                                </DropdownMenuItem>
                              ) : null}
                              {link.status === "ACTIVE" ? (
                                <DropdownMenuItem onClick={() => setSuspendTarget(link)}>
                                  Suspender
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem variant="destructive" onClick={() => setRevokeTarget(link)}>
                                Revogar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={canManage ? 6 : 5} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>Nenhum prestador SST cadastrado ainda.</p>
                    {canManage ? (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <PlusIcon />
                        Cadastrar o primeiro prestador
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canManage ? (
        <CreateProviderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      <AlertDialog open={Boolean(suspendTarget)} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspender {suspendTarget?.provider.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              O prestador deixa de poder gerenciar treinamentos desta empresa até ser autorizado
              de novo. Treinamentos já configurados para ele não são alterados automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuspendConfirm}
              disabled={isWorking}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isWorking ? "Suspendendo..." : "Suspender"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar {revokeTarget?.provider.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ação definitiva — o vínculo não pode ser reativado depois (seria necessário
              cadastrar o prestador novamente). Treinamentos já configurados para ele não são
              alterados automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={isWorking}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isWorking ? "Revogando..." : "Revogar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateProviderDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accessLevel, setAccessLevel] = useState<ProviderAccessLevel>("OPERATION");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDocument("");
      setEmail("");
      setPhone("");
      setAccessLevel("OPERATION");
      setFormError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/sst-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, document, email, phone, accessLevel }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success("Prestador cadastrado — autorize o vínculo para liberar o acesso.");
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
          <DialogTitle>Novo prestador SST</DialogTitle>
          <DialogDescription>
            O prestador nasce pendente — use &quot;Autorizar&quot; na lista para liberar o acesso.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="provider-name">Nome</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-document">CNPJ/CPF</Label>
            <Input
              id="provider-document"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="provider-email">E-mail</Label>
              <Input
                id="provider-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="provider-phone">Telefone</Label>
              <Input
                id="provider-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Nível de acesso</Label>
            <Select
              items={ACCESS_LEVEL_LABELS}
              value={accessLevel}
              onValueChange={(value) => setAccessLevel(value as ProviderAccessLevel)}
              disabled={isSubmitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Só Operação ou Administração permitem gerenciar treinamentos.
            </p>
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
