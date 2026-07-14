"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, MoreHorizontalIcon, SearchIcon } from "lucide-react";
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

type ProviderLinkStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED" | "REJECTED";
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
  REJECTED: "Recusado",
};

const STATUS_BADGE_VARIANT: Record<ProviderLinkStatus, "default" | "outline" | "secondary" | "destructive"> = {
  PENDING: "outline",
  ACTIVE: "default",
  SUSPENDED: "secondary",
  REVOKED: "destructive",
  REJECTED: "destructive",
};

// Estados terminais (Sprint Comercial SST 1.4, §12/§15) — nunca aceitam
// nenhuma ação depois disso; um novo acesso exige um novo pedido de
// autorização, nunca a reativação do vínculo antigo.
const TERMINAL_STATUSES: ProviderLinkStatus[] = ["REVOKED", "REJECTED"];

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
  const [approveTarget, setApproveTarget] = useState<ProviderLinkRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ProviderLinkRow | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<ProviderLinkRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ProviderLinkRow | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const pendingCount = initialLinks.filter((link) => link.status === "PENDING").length;

  async function updateStatus(id: string, status: Exclude<ProviderLinkStatus, "PENDING">, accessLevel?: ProviderAccessLevel) {
    const response = await fetch(`/api/sst-providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(accessLevel ? { accessLevel } : {}) }),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response));
  }

  // Aprovar/recusar usam o contrato dedicado (Sprint Comercial SST 1.4,
  // §15) em vez do PATCH genérico — suspender/revogar continuam nele
  // (updateStatus), que não muda de contrato nesta sprint.
  async function handleApproveConfirm(accessLevel: ProviderAccessLevel) {
    if (!approveTarget) return;
    setIsWorking(true);
    try {
      const response = await fetch(`/api/sst-providers/requests/${approveTarget.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessLevel }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`${approveTarget.provider.name} autorizado.`);
      setApproveTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectTarget) return;
    setIsWorking(true);
    try {
      const response = await fetch(`/api/sst-providers/requests/${rejectTarget.id}/reject`, { method: "POST" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`Solicitação de ${rejectTarget.provider.name} recusada.`);
      setRejectTarget(null);
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
        <div className="flex items-center justify-between gap-2">
          {pendingCount > 0 ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{pendingCount}</Badge>
              <span className="text-sm text-muted-foreground">
                {pendingCount === 1 ? "solicitação de acesso pendente" : "solicitações de acesso pendentes"}
              </span>
            </div>
          ) : (
            <span />
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <SearchIcon />
            Buscar prestador
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
                      {TERMINAL_STATUSES.includes(link.status) ? null : (
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
                              {link.status === "PENDING" ? (
                                <>
                                  <DropdownMenuItem onClick={() => setApproveTarget(link)} disabled={isWorking}>
                                    Aprovar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem variant="destructive" onClick={() => setRejectTarget(link)} disabled={isWorking}>
                                    Recusar
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                              {link.status === "SUSPENDED" ? (
                                <DropdownMenuItem onClick={() => setApproveTarget(link)} disabled={isWorking}>
                                  Autorizar
                                </DropdownMenuItem>
                              ) : null}
                              {link.status === "ACTIVE" ? (
                                <DropdownMenuItem onClick={() => setSuspendTarget(link)}>
                                  Suspender
                                </DropdownMenuItem>
                              ) : null}
                              {link.status === "ACTIVE" || link.status === "SUSPENDED" ? (
                                <DropdownMenuItem variant="destructive" onClick={() => setRevokeTarget(link)}>
                                  Revogar
                                </DropdownMenuItem>
                              ) : null}
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
                    <p>Nenhum prestador SST autorizado ainda.</p>
                    {canManage ? (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <SearchIcon />
                        Buscar prestador
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
        <SearchAndLinkProviderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      <ApproveLinkDialog
        target={approveTarget}
        isWorking={isWorking}
        onCancel={() => setApproveTarget(null)}
        onConfirm={handleApproveConfirm}
      />

      <AlertDialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recusar solicitação de {rejectTarget?.provider.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A consultoria não terá acesso aos dados desta empresa. Ação definitiva — para
              autorizar essa consultoria no futuro, será necessário um novo pedido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRejectConfirm}
              disabled={isWorking}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isWorking ? "Recusando..." : "Recusar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

/** Aprova (ACTIVE) um vínculo PENDING ou reautoriza um SUSPENDED — a empresa
 * escolhe o nível de acesso no momento da aprovação (Sprint Comercial SST
 * 1.4, §14), em vez de herdar o nível pedido pela consultoria. */
function ApproveLinkDialog({
  target,
  isWorking,
  onCancel,
  onConfirm,
}: {
  target: ProviderLinkRow | null;
  isWorking: boolean;
  onCancel: () => void;
  onConfirm: (accessLevel: ProviderAccessLevel) => void;
}) {
  const [accessLevel, setAccessLevel] = useState<ProviderAccessLevel>("OPERATION");

  useEffect(() => {
    if (target) setAccessLevel(target.accessLevel);
  }, [target]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Autorizar {target?.provider.name}</DialogTitle>
          <DialogDescription>
            Escolha o nível de acesso que esta consultoria terá sobre os dados desta empresa.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Nível de acesso</Label>
          <Select
            items={ACCESS_LEVEL_LABELS}
            value={accessLevel}
            onValueChange={(value) => setAccessLevel(value as ProviderAccessLevel)}
            disabled={isWorking}
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
          <Button type="button" variant="outline" onClick={onCancel} disabled={isWorking}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => onConfirm(accessLevel)} disabled={isWorking}>
            {isWorking ? <Loader2Icon className="animate-spin" /> : null}
            Autorizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ProviderSearchResult = { id: string; name: string; document: string | null };

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

/**
 * Busca de prestador SST já cadastrado no sistema, com seleção e
 * autorização — substitui o antigo formulário "Novo prestador" (que criava
 * um `SstProvider` do zero a cada empresa, mesmo para a mesma consultoria
 * real; ver docs/sst-providers.md, seção 2). Aqui a empresa só ENCONTRA e
 * VINCULA um prestador que já existe — nunca cria um registro novo. O
 * vínculo nasce PENDING, igual antes; "Autorizar" continua sendo a ação
 * separada já existente na tabela (mantém a distinção de audit trail entre
 * "vínculo criado" e "vínculo aprovado").
 */
function SearchAndLinkProviderDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProviderSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<ProviderSearchResult | null>(null);
  const [accessLevel, setAccessLevel] = useState<ProviderAccessLevel>("OPERATION");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(null);
      setAccessLevel("OPERATION");
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || selected) return;
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/sst-providers/search?q=${encodeURIComponent(query.trim())}`);
        if (!response.ok) throw new Error(await parseErrorMessage(response));
        const data = (await response.json()) as { providers: ProviderSearchResult[] };
        setResults(data.providers);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, selected]);

  async function handleLink() {
    if (!selected) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/sst-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: selected.id, accessLevel }),
      });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      toast.success(`${selected.name} vinculado — use "Autorizar" na lista para liberar o acesso.`);
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
          <DialogTitle>Buscar prestador SST</DialogTitle>
          <DialogDescription>
            Encontre uma consultoria já cadastrada no sistema e autorize o acesso — o vínculo nasce
            pendente, use &quot;Autorizar&quot; na lista para liberar o acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          {selected ? (
            <div className="grid gap-1 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{selected.name}</p>
                  {selected.document ? (
                    <p className="text-xs text-muted-foreground">{selected.document}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(null)}
                  disabled={isSubmitting}
                >
                  Trocar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="provider-search">Nome do prestador</Label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="provider-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Digite ao menos 3 letras do nome..."
                  className="pl-8"
                  autoFocus
                />
              </div>

              {query.trim().length >= MIN_QUERY_LENGTH ? (
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border">
                  {isSearching ? (
                    <p className="p-3 text-center text-sm text-muted-foreground">Buscando...</p>
                  ) : results.length === 0 ? (
                    <p className="p-3 text-center text-sm text-muted-foreground">
                      Nenhum prestador encontrado com esse nome.
                    </p>
                  ) : (
                    results.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelected(provider)}
                        className="grid cursor-pointer gap-0.5 border-b p-2.5 text-left last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      >
                        <span className="text-sm font-medium">{provider.name}</span>
                        {provider.document ? (
                          <span className="text-xs text-muted-foreground">{provider.document}</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Digite ao menos 3 letras para buscar.
                </p>
              )}
            </div>
          )}

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
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleLink} disabled={isSubmitting || !selected}>
            {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
