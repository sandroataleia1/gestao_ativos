import type { Metadata } from "next";

import { NotificationsPageClient } from "@/components/notifications/notifications-page-client";

export const metadata: Metadata = {
  title: "Notificações — Administração da plataforma",
};

// Sprint SST 1.4E, §22 — página completa de notificações do Portal Super
// Admin. Autorização garantida pelo layout (requirePlatformRoleOrDeny) e
// por cada rota de API (requirePlatformRole("SUPER_ADMIN")).
export default function PlatformNotificationsPage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notificações</h1>
        <p className="text-sm text-muted-foreground">Reivindicações e disputas empresariais que exigem análise.</p>
      </div>
      <NotificationsPageClient
        apiBase="/api/platform-admin/notifications"
        categories={[
          { value: "CLAIMS", label: "Reivindicações" },
          { value: "DISPUTES", label: "Disputas" },
        ]}
      />
    </div>
  );
}
