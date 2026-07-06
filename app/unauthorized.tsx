import Link from "next/link";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LockIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Sessão necessária</h1>
        <p className="text-sm text-muted-foreground">
          Você precisa entrar para acessar esta página.
        </p>
      </div>
      <Button render={<Link href="/login" />}>Entrar</Button>
    </div>
  );
}
