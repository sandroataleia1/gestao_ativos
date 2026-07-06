import Link from "next/link";
import { QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function QrTokenNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <QrCodeIcon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">QR Code não encontrado</h1>
        <p className="text-sm text-muted-foreground">
          Este código não corresponde a nenhum ativo, unidade ou custódia cadastrada.
        </p>
      </div>
      <Button render={<Link href="/login" />}>Entrar no sistema</Button>
    </div>
  );
}
