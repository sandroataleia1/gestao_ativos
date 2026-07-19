import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";

import { getCurrentSstUser } from "@/lib/sst-auth";
import { SstRegisterForm } from "./sst-register-form";

export const metadata: Metadata = {
  title: "Cadastrar consultoria — Portal Consultoria SST",
};

// Fora do layout protegido de app/sst/layout.tsx (rota irmã de
// app/sst/login), mesmo raciocínio: precisa ser acessível sem sessão.
export default async function SstRegisterPage() {
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
          <h1 className="text-2xl font-semibold tracking-tight">Cadastrar consultoria</h1>
          <p className="text-sm text-muted-foreground">
            Crie o acesso da sua consultoria para gerenciar a conformidade das empresas que a autorizarem.
          </p>
        </div>

        <SstRegisterForm />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem uma conta?{" "}
          <Link href="/sst/login" className="font-medium text-foreground underline underline-offset-4">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
