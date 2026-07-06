import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlertIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Acesso negado</h1>
        <p className="text-sm text-muted-foreground">
          Você está autenticado, mas não tem permissão para acessar esta página.
        </p>
      </div>
      <Button render={<Link href="/dashboard" />}>Voltar ao dashboard</Button>
    </div>
  );
}
