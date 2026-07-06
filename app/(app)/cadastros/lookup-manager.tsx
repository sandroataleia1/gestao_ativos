"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { MASK_FUNCTIONS } from "@/lib/masks";
import { focusFirstFieldWithError } from "@/lib/form-focus";
import type { LookupEntityConfig, LookupRow } from "./types";

function ColorCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block size-3 shrink-0 rounded-full border"
        style={{ backgroundColor: value }}
      />
      {value}
    </span>
  );
}

export function LookupManager({
  config,
  initialRows,
  canManage,
}: {
  config: LookupEntityConfig;
  initialRows: LookupRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [formState, setFormState] = useState<{ open: boolean; row: LookupRow | null }>({
    open: false,
    row: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<LookupRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? initialRows.filter((row) => String(row[config.nameField] ?? "").toLowerCase().includes(q))
      : initialRows;

    if (!sort) return rows;
    const sorted = [...rows].sort((a, b) => {
      const aValue = String(a[sort.key] ?? "");
      const bValue = String(b[sort.key] ?? "");
      return aValue.localeCompare(bValue, "pt-BR", { sensitivity: "base" });
    });
    return sort.desc ? sorted.reverse() : sorted;
  }, [initialRows, search, config.nameField, sort]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, desc: false };
      if (!prev.desc) return { key, desc: true };
      return null;
    });
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`${config.apiBasePath}/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Não foi possível excluir.");
      }
      toast.success(`${config.title} desativado(a).`);
      setDeleteTarget(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setIsDeleting(false);
    }
  }

  const extraColumns = (config.hasActiveToggle ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Buscar em ${config.tabLabel.toLowerCase()}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-64 pl-8"
          />
        </div>
        {canManage ? (
          <Button onClick={() => setFormState({ open: true, row: null })}>
            <PlusIcon />
            Novo
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {config.columns.map((col) => {
                const isSorted = sort?.key === col.key;
                return (
                  <TableHead key={col.key}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="-mx-2 flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left font-medium transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {col.label}
                      {isSorted ? (
                        sort?.desc ? (
                          <ArrowDownIcon className="size-3.5 text-foreground" />
                        ) : (
                          <ArrowUpIcon className="size-3.5 text-foreground" />
                        )
                      ) : (
                        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/50" />
                      )}
                    </button>
                  </TableHead>
                );
              })}
              {config.hasActiveToggle ? <TableHead>Status</TableHead> : null}
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  {config.columns.map((col) => (
                    <TableCell key={col.key}>
                      {col.isColor ? (
                        <ColorCell value={row[col.key] as string | null} />
                      ) : (
                        (row[col.key] as string) || "—"
                      )}
                    </TableCell>
                  ))}
                  {config.hasActiveToggle ? (
                    <TableCell>
                      <Badge variant={row.active === false ? "outline" : "default"}>
                        {row.active === false ? "Inativo" : "Ativo"}
                      </Badge>
                    </TableCell>
                  ) : null}
                  {canManage ? (
                    <TableCell>
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label="Ações">
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setFormState({ open: true, row })}>
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(row)}>
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={config.columns.length + extraColumns} className="h-32 text-center">
                  <div className="grid justify-items-center gap-2 text-muted-foreground">
                    <p>
                      {initialRows.length
                        ? "Nenhum registro encontrado para a busca."
                        : `Nenhum(a) ${config.title.toLowerCase()} cadastrado(a) ainda.`}
                    </p>
                    {canManage && !initialRows.length ? (
                      <Button size="sm" onClick={() => setFormState({ open: true, row: null })}>
                        <PlusIcon />
                        Criar o primeiro registro
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
        <LookupFormDialog
          config={config}
          open={formState.open}
          row={formState.row}
          onOpenChange={(open) => setFormState((prev) => ({ ...prev, open }))}
          onSuccess={() => {
            setFormState({ open: false, row: null });
            router.refresh();
          }}
        />
      ) : null}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {config.title.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? String(deleteTarget[config.nameField]) : ""} será desativado(a). O cadastro é
              preservado (ativos vinculados nunca são apagados).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isDeleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LookupFormDialog({
  config,
  open,
  row,
  onOpenChange,
  onSuccess,
}: {
  config: LookupEntityConfig;
  open: boolean;
  row: LookupRow | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const isEditing = Boolean(row);
  const [values, setValues] = useState<Record<string, string>>({});
  const [active, setActive] = useState("true");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const field of config.fields) {
        initial[field.key] = row ? String(row[field.key] ?? "") : "";
      }
      setValues(initial);
      setActive(row?.active === false ? "false" : "true");
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, row, config.fields]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const payload: Record<string, unknown> = { ...values };
    if (config.hasActiveToggle) payload.active = active === "true";

    try {
      const response = await fetch(isEditing ? `${config.apiBasePath}/${row!.id}` : config.apiBasePath, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.fieldErrors) {
          setFieldErrors(data.fieldErrors);
          focusFirstFieldWithError(
            data.fieldErrors,
            config.fields.map((field) => field.key),
            (key) => `lookup-${key}`,
          );
        }
        setFormError(data?.error ?? "Não foi possível salvar.");
        return;
      }

      toast.success(isEditing ? `${config.title} atualizado(a).` : `${config.title} criado(a).`);
      onSuccess();
    } catch {
      setFormError("Não foi possível conectar ao servidor.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `Editar ${config.title.toLowerCase()}` : `Novo(a) ${config.title.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? "Atualize os dados do cadastro." : "Preencha os dados para criar um novo cadastro."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          {config.fields.map((field) => (
            <div key={field.key} className="grid gap-2">
              <Label htmlFor={`lookup-${field.key}`}>{field.label}</Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={`lookup-${field.key}`}
                  rows={3}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setField(field.key, event.target.value)}
                  disabled={isSubmitting}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    id={`lookup-${field.key}`}
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setField(field.key, field.mask ? MASK_FUNCTIONS[field.mask](raw) : raw);
                    }}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(fieldErrors[field.key])}
                  />
                  {field.isColor && values[field.key] ? (
                    <span
                      className="size-8 shrink-0 rounded-md border"
                      style={{ backgroundColor: values[field.key] }}
                    />
                  ) : null}
                </div>
              )}
              {fieldErrors[field.key] ? (
                <p className="text-sm text-destructive">{fieldErrors[field.key][0]}</p>
              ) : null}
            </div>
          ))}

          {config.hasActiveToggle ? (
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                items={{ true: "Ativo", false: "Inativo" }}
                value={active}
                onValueChange={(value) => setActive((value as string) ?? "true")}
                disabled={isSubmitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Ativo</SelectItem>
                  <SelectItem value="false">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
              {isEditing ? "Salvar alterações" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
