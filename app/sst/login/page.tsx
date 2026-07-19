import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentSstUser } from "@/lib/sst-auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SST_AUTH_SHELL_PROPS } from "@/components/auth/sst-auth-shell-props";
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
    <AuthShell
      {...SST_AUTH_SHELL_PROPS}
      title="Entrar"
      description="Acesse o acompanhamento de conformidade das empresas que autorizaram sua consultoria."
      footer={
        <>
          Ainda não tem uma conta?{" "}
          <Link href="/sst/register" className="font-medium text-foreground underline underline-offset-4">
            Cadastre sua consultoria
          </Link>
        </>
      }
    >
      <SstLoginForm />
    </AuthShell>
  );
}
