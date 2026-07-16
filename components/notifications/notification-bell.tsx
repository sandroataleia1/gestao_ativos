"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClientNotification } from "@/lib/notifications-client-dto";

// Sprint SST 1.4E, §19-§21/§24/§26 — sino compartilhado pelos três portais
// (Empresa/Consultoria/Plataforma), parametrizado só pela base da API e
// pela rota da página completa. Nunca implementa WebSocket/SSE — só
// carregamento inicial + atualização ao abrir o popover + após read/
// read-all + ao voltar o foco da janela + polling moderado (nunca abaixo de
// 30s), conforme §24. Usa DropdownMenu (não existe Popover/ScrollArea neste
// projeto — reaproveita o overlay acessível já usado em UserMenu, em vez de
// adicionar uma biblioteca nova só para o sino).

const SEVERITY_DOT: Record<string, string> = {
  INFO: "bg-blue-500",
  SUCCESS: "bg-emerald-500",
  WARNING: "bg-amber-500",
  CRITICAL: "bg-red-500",
};
const SEVERITY_LABEL: Record<string, string> = {
  INFO: "Informativo",
  SUCCESS: "Sucesso",
  WARNING: "Atenção",
  CRITICAL: "Crítico",
};

const POLL_INTERVAL_MS = 45_000;

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "Agora";
  if (diffMin < 60) return `Há ${diffMin} minuto${diffMin === 1 ? "" : "s"}`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `Há ${diffHour} hora${diffHour === 1 ? "" : "s"}`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return "Ontem";
  if (diffDay < 7) return `Há ${diffDay} dias`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function NotificationBell({
  apiBase,
  historyHref,
  triggerClassName,
}: {
  apiBase: string;
  historyHref: string;
  /** Mesmo motivo de `triggerClassName` em UserMenu (components/layout/user-menu.tsx)
   * — o Portal Consultoria usa um fundo escuro na topbar onde o ghost button
   * padrão fica ilegível sem uma cor explícita. */
  triggerClassName?: string;
}) {
  const [items, setItems] = useState<ClientNotification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/unread-count`);
      if (!res.ok) return;
      const data = (await res.json()) as { count?: number };
      setUnreadCount(data.count ?? 0);
    } catch {
      // Contador é best-effort — nunca quebra a topbar por falha de rede.
    }
  }, [apiBase]);

  const loadItems = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${apiBase}?view=bell`);
      if (!res.ok) throw new Error("request_failed");
      const data = (await res.json()) as { items?: ClientNotification[] };
      setItems(data.items ?? []);
    } catch {
      setError("Não foi possível carregar as notificações.");
    }
  }, [apiBase]);

  useEffect(() => {
    loadCount();
    function onFocus() {
      loadCount();
    }
    window.addEventListener("focus", onFocus);
    const interval = setInterval(loadCount, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [loadCount]);

  useEffect(() => {
    if (open) loadItems();
  }, [open, loadItems]);

  async function markRead(id: string) {
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, isRead: true } : i)) ?? prev);
    setLiveMessage("Notificação marcada como lida.");
    try {
      await fetch(`${apiBase}/${id}/read`, { method: "POST" });
    } finally {
      loadCount();
    }
  }

  async function markAllRead() {
    setItems((prev) => prev?.map((i) => ({ ...i, isRead: true })) ?? prev);
    setLiveMessage("Todas as notificações foram marcadas como lidas.");
    try {
      await fetch(`${apiBase}/read-all`, { method: "POST" });
    } finally {
      setUnreadCount(0);
    }
  }

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("relative", triggerClassName)}
            aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
          >
            <BellIcon className="size-5" />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
              >
                {badgeLabel}
              </span>
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
          <span>Notificações</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            Marcar todas como lidas
          </Button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p className="p-3 text-sm text-muted-foreground">{error}</p>
          ) : items === null ? (
            <p className="p-3 text-sm text-muted-foreground">Carregando…</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhuma notificação pendente.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className={cn("border-b p-3 text-sm last:border-b-0", !item.isRead && "bg-muted/40")}>
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight text-foreground">
                      {item.title}
                      <span className="sr-only"> — {SEVERITY_LABEL[item.severity] ?? item.severity}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{item.message}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <time dateTime={item.createdAt} className="text-[11px] text-muted-foreground">
                        {formatRelative(item.createdAt)}
                      </time>
                      <div className="flex items-center gap-2">
                        {item.href ? (
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            onClick={() => markRead(item.id)}
                            render={<Link href={item.href} />}
                          >
                            Ver
                          </Button>
                        ) : null}
                        {!item.isRead ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto px-1.5 py-0.5 text-xs"
                            onClick={() => markRead(item.id)}
                          >
                            Marcar como lida
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={historyHref} />}>Ver todas</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
