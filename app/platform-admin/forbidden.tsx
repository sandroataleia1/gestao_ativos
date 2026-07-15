import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Override do boundary raiz (app/forbidden.tsx) para o segmento
// /platform-admin — mostrado para qualquer usuário autenticado SEM
// PlatformUser ativo (Company ADMIN, SstProvider OWNER, usuário comum, ou
// um PlatformUser que foi revogado). Nunca revela se o usuário já teve
// acesso algum dia.
export default function PlatformAdminForbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center text-zinc-50">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/20 text-destructive">
        <ShieldAlertIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Acesso negado</h1>
        <p className="text-sm text-zinc-400">
          Você está autenticado, mas não tem permissão para acessar o ambiente administrativo da plataforma.
        </p>
      </div>
      <Button variant="outline" render={<Link href="/dashboard" />}>
        Voltar
      </Button>
    </div>
  );
}
