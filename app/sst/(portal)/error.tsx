"use client";

import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Boundary de erro do Portal Consultoria inteiro — nenhuma página aqui
// mostra stack trace, nome de exceção ou detalhe técnico ao usuário (Sprint
// Demo Comercial SST 1.0, Parte 9): sempre esta mensagem genérica, com
// tentativa de nova renderização e retorno ao dashboard.
export default function SstPortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Não foi possível carregar esta página</h1>
        <p className="text-sm text-muted-foreground">
          Ocorreu um problema inesperado. Tente novamente em instantes.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Tentar novamente
        </Button>
        <Button render={<Link href="/sst/dashboard" />}>Voltar ao dashboard</Button>
      </div>
    </div>
  );
}
