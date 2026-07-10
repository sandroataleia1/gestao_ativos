import Link from "next/link";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Override do boundary raiz (app/unauthorized.tsx) para o segmento /sst —
// o link "Entrar" da raiz aponta para /login (Portal Empresa), não
// /sst/login.
export default function SstUnauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LockIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Sessão necessária</h1>
        <p className="text-sm text-muted-foreground">
          Você precisa entrar no Portal Consultoria para acessar esta página.
        </p>
      </div>
      <Button render={<Link href="/sst/login" />}>Entrar</Button>
    </div>
  );
}
