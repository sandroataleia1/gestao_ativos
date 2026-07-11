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
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button render={<Link href="/dashboard" />}>Voltar ao dashboard</Button>
        {/* Sprint 0.6, Parte D: link explícito de recuperação — cobre o
            caso de um cookie de contexto (`active_company_id`) apontando
            para uma empresa/membership que não é mais válida (revogada,
            de outro usuário, ou de uma empresa agora indisponível). A
            página /select-company nunca depende desse cookie para
            carregar. */}
        <Button variant="outline" render={<Link href="/select-company" />}>
          Trocar de empresa
        </Button>
      </div>
    </div>
  );
}
