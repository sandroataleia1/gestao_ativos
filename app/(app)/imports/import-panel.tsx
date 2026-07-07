"use client";

import { useMemo, useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ImportRowResult = {
  rowNumber: number;
  status: "valid" | "error";
  errors: string[];
  notes: string[];
  action?: "created" | "updated" | "skipped";
  preview: Record<string, string>;
};

type ImportResult = {
  summary: { total: number; valid: number; withError: number; created: number; updated: number; skipped: number };
  rows: ImportRowResult[];
};

export function ImportPanel({
  type,
  templates,
  canManage,
}: {
  type: "employees" | "assets" | "stock";
  templates: { label: string; templateType: string }[];
  canManage: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState<ImportResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const previewColumns = useMemo(() => {
    const firstRow = preview?.rows[0];
    return firstRow ? Object.keys(firstRow.preview) : [];
  }, [preview]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setConfirmed(null);
  }

  async function handlePreview() {
    if (!selectedFile) {
      toast.error("Selecione um arquivo .xlsx primeiro.");
      return;
    }
    setIsPreviewing(true);
    try {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("file", selectedFile);

      const response = await fetch("/api/imports/preview", { method: "POST", body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error ?? "Não foi possível pré-visualizar o arquivo.");
        return;
      }
      setPreview(data);
      setConfirmed(null);
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!selectedFile) return;
    setIsConfirming(true);
    try {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("file", selectedFile);

      const response = await fetch("/api/imports/confirm", { method: "POST", body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(data?.error ?? "Não foi possível confirmar a importação.");
        return;
      }
      setConfirmed(data);
      toast.success("Importação concluída.");
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    } finally {
      setIsConfirming(false);
    }
  }

  const summary = confirmed?.summary ?? preview?.summary ?? null;
  const rows = confirmed?.rows ?? preview?.rows ?? [];
  const hasErrors = (preview?.summary.withError ?? 0) > 0;
  const hasValidRows = (preview?.summary.valid ?? 0) > 0;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Baixar modelo</CardTitle>
          <CardDescription>Preencha a planilha seguindo exatamente as colunas do modelo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <Button
              key={template.templateType}
              type="button"
              variant="outline"
              render={<a href={`/api/imports/templates/${template.templateType}`} />}
            >
              <DownloadIcon />
              {template.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Enviar arquivo</CardTitle>
            <CardDescription>Selecione o .xlsx preenchido e pré-visualize antes de importar.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="text-sm"
            />
            <Button type="button" onClick={handlePreview} disabled={!selectedFile || isPreviewing}>
              {isPreviewing ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              Pré-visualizar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Você tem permissão apenas para baixar modelos. Para enviar e importar planilhas, é preciso a permissão
            de gerenciamento de importações.
          </CardContent>
        </Card>
      )}

      {canManage && summary ? (
        <Card>
          <CardHeader>
            <CardTitle>{confirmed ? "Resultado da importação" : "3. Pré-visualização"}</CardTitle>
            <CardDescription>
              {confirmed
                ? "Importação processada — cada linha foi gravada (ou não) de forma independente."
                : "Nada foi gravado ainda. Confira os erros antes de confirmar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">Total: {summary.total}</Badge>
              <Badge variant="outline">Válidas: {summary.valid}</Badge>
              <Badge variant={summary.withError ? "destructive" : "outline"}>Com erro: {summary.withError}</Badge>
              {confirmed ? (
                <>
                  <Badge variant="default">Criadas: {summary.created}</Badge>
                  <Badge variant="outline">Atualizadas: {summary.updated}</Badge>
                  <Badge variant="outline">Ignoradas: {summary.skipped}</Badge>
                </>
              ) : null}
            </div>

            <div className="max-h-112 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    {previewColumns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell>{row.rowNumber}</TableCell>
                      {previewColumns.map((column) => (
                        <TableCell key={column} className="max-w-40 truncate">
                          {row.preview[column]}
                        </TableCell>
                      ))}
                      <TableCell>
                        {row.action ? (
                          <Badge variant={row.action === "skipped" ? "outline" : "default"}>
                            {row.action === "created" ? "Criada" : row.action === "updated" ? "Atualizada" : "Ignorada"}
                          </Badge>
                        ) : (
                          <Badge variant={row.status === "error" ? "destructive" : "outline"}>
                            {row.status === "error" ? "Erro" : "Válida"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">
                        {[...row.errors, ...row.notes].join(" — ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {!confirmed ? (
              <div className="flex flex-wrap gap-2">
                {!hasErrors && hasValidRows ? (
                  <Button type="button" onClick={handleConfirm} disabled={isConfirming}>
                    {isConfirming ? <Loader2Icon className="animate-spin" /> : null}
                    Confirmar importação
                  </Button>
                ) : null}
                {hasErrors && hasValidRows ? (
                  <Button type="button" variant="outline" onClick={handleConfirm} disabled={isConfirming}>
                    {isConfirming ? <Loader2Icon className="animate-spin" /> : null}
                    Importar apenas linhas válidas
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
