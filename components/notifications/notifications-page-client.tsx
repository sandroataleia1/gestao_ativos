"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClientNotification } from "@/lib/notifications-client-dto";

// Sprint SST 1.4E, §22 — página completa de notificações, compartilhada
// pelos três portais (parametrizada só pela base da API e pelas categorias
// disponíveis). Paginação sempre resolvida no servidor (a API já pagina via
// Prisma skip/take) — este componente só decide QUAIS parâmetros pedir,
// nunca carrega tudo de uma vez.

export type NotificationCategoryTab = { value: string; label: string };

const SEVERITY_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  INFO: "outline",
  SUCCESS: "default",
  WARNING: "secondary",
  CRITICAL: "destructive",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type PageData = { items: ClientNotification[]; totalCount: number; pageSize: number };

export function NotificationsPageClient({ apiBase, categories }: { apiBase: string; categories?: NotificationCategoryTab[] }) {
  const [status, setStatus] = useState<"ALL" | "UNREAD">("ALL");
  const [category, setCategory] = useState<string>("ALL");
  const [pageNum, setPageNum] = useState(1);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("filter", status);
      if (category !== "ALL") params.set("category", category);
      params.set("page", String(pageNum));
      const res = await fetch(`${apiBase}?${params.toString()}`);
      if (!res.ok) throw new Error("request_failed");
      setData(await res.json());
    } catch {
      setError("Não foi possível carregar as notificações.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, status, category, pageNum]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    setData((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, isRead: true } : i)) } : prev));
    await fetch(`${apiBase}/${id}/read`, { method: "POST" });
  }

  async function markAllRead() {
    await fetch(`${apiBase}/read-all`, { method: "POST" });
    load();
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / data.pageSize)) : 1;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por status">
          {(["ALL", "UNREAD"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPageNum(1);
              }}
            >
              {s === "ALL" ? "Todas" : "Não lidas"}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={markAllRead}>
          Marcar todas como lidas
        </Button>
      </div>

      {categories && categories.length > 0 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar por categoria">
          <Button
            size="sm"
            variant={category === "ALL" ? "secondary" : "ghost"}
            aria-pressed={category === "ALL"}
            onClick={() => {
              setCategory("ALL");
              setPageNum(1);
            }}
          >
            Todas
          </Button>
          {categories.map((c) => (
            <Button
              key={c.value}
              size="sm"
              variant={category === c.value ? "secondary" : "ghost"}
              aria-pressed={category === c.value}
              onClick={() => {
                setCategory(c.value);
                setPageNum(1);
              }}
            >
              {c.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border" role="status" aria-live="polite">
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">{error}</p>
        ) : loading && !data ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : !data || data.items.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma notificação encontrada.</p>
        ) : (
          <ul className="divide-y">
            {data.items.map((item) => (
              <li
                key={item.id}
                className={cn("flex flex-wrap items-start justify-between gap-3 p-4", !item.isRead && "bg-muted/30")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={SEVERITY_VARIANT[item.severity] ?? "outline"}>{item.severity}</Badge>
                    <p className="font-medium">{item.title}</p>
                    {!item.isRead ? <span className="sr-only">Não lida</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  <time dateTime={item.createdAt} className="mt-1 block text-xs text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.href ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markRead(item.id)}
                      render={<Link href={item.href} />}
                    >
                      Abrir
                    </Button>
                  ) : null}
                  {!item.isRead ? (
                    <Button size="sm" variant="ghost" onClick={() => markRead(item.id)}>
                      Marcar como lida
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pageNum} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>
              Anterior
            </Button>
            <Button size="sm" variant="outline" disabled={pageNum >= totalPages} onClick={() => setPageNum((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
