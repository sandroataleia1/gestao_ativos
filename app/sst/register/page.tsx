import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentSstUser } from "@/lib/sst-auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SST_AUTH_SHELL_PROPS } from "@/components/auth/sst-auth-shell-props";
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
    <AuthShell
      {...SST_AUTH_SHELL_PROPS}
      title="Cadastrar consultoria"
      description="Crie o acesso da sua consultoria para gerenciar a conformidade das empresas que a autorizarem."
      footer={
        <>
          Já tem uma conta?{" "}
          <Link href="/sst/login" className="font-medium text-foreground underline underline-offset-4">
            Entrar
          </Link>
        </>
      }
    >
      <SstRegisterForm />
    </AuthShell>
  );
}
