import type { Metadata } from "next";

import { NotificationsPageClient } from "@/components/notifications/notifications-page-client";

export const metadata: Metadata = {
  title: "Notificações — Gestão de Ativos",
};

// Sprint SST 1.4E, §22 — página completa de notificações do Portal Empresa.
// A autorização real já está garantida pelo layout (app/(app)/layout.tsx,
// requireCompanyOrDeny) e por cada rota de API chamada pelo client
// (requireCompany() + permissão) — esta página é só a casca visual.
export default function CompanyNotificationsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notificações</h1>
        <p className="text-sm text-muted-foreground">Solicitações e decisões relacionadas às consultorias SST desta empresa.</p>
      </div>
      <NotificationsPageClient
        apiBase="/api/notifications"
        categories={[{ value: "SST_ACCESS", label: "Acesso SST" }]}
      />
    </div>
  );
}
