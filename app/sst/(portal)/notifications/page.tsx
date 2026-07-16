import type { Metadata } from "next";

import { NotificationsPageClient } from "@/components/notifications/notifications-page-client";

export const metadata: Metadata = {
  title: "Notificações — Portal Consultoria",
};

// Sprint SST 1.4E, §22 — página completa de notificações do Portal
// Consultoria. Autorização garantida pelo layout (requireSstAuthOrDeny) e
// por cada rota de API (requireSstAuth() + papel).
export default function SstNotificationsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notificações</h1>
        <p className="text-sm text-muted-foreground">Acessos e decisões das empresas autorizadas à sua consultoria.</p>
      </div>
      <NotificationsPageClient
        apiBase="/api/sst/notifications"
        categories={[
          { value: "ACCESSES", label: "Acessos" },
          { value: "COMPANIES", label: "Empresas" },
        ]}
      />
    </div>
  );
}
