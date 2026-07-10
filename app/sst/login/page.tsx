import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";

import { getCurrentSstUser } from "@/lib/sst-auth";
import { SstLoginForm } from "./sst-login-form";

export const metadata: Metadata = {
  title: "Entrar — Portal Consultoria SST",
};

// Fora do layout protegido de app/sst/layout.tsx (rota irmã, sem
// requireSstAuthOrDeny) — senão ninguém sem acesso conseguiria sequer ver
// a tela de login para descobrir que não tem acesso.
export default async function SstLoginPage() {
  const sstUser = await getCurrentSstUser();
  if (sstUser) {
    redirect("/sst/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 font-heading text-lg font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </span>
          Portal Consultoria SST
        </div>

        <div className="mb-6 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-sm text-muted-foreground">
            Acesse o acompanhamento de conformidade das empresas que autorizaram sua consultoria.
          </p>
        </div>

        <SstLoginForm />
      </div>
    </div>
  );
}
