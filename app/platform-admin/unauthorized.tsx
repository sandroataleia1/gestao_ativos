import Link from "next/link";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Override do boundary raiz (app/unauthorized.tsx) para o segmento
// /platform-admin — mesmo padrão de app/sst/unauthorized.tsx.
export default function PlatformAdminUnauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center text-zinc-50">
      <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white">
        <LockIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Sessão necessária</h1>
        <p className="text-sm text-zinc-400">Você precisa entrar para acessar o ambiente administrativo da plataforma.</p>
      </div>
      <Button render={<Link href="/login" />}>Entrar</Button>
    </div>
  );
}
