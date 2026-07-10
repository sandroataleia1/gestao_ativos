import type { Metadata } from "next";
import Link from "next/link";
import { BoxesIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Esqueci minha senha — Gestão de Ativos",
};

// Página pública (sem sessão) — só coleta o e-mail e dispara
// /api/auth/request-password-reset (endpoint nativo do Better Auth). Não
// consulta nada aqui: a mensagem de sucesso é sempre a mesma, exista ou não
// o e-mail (ver forgot-password-form.tsx), para não vazar quais contas
// estão cadastradas.
export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted/30 p-6">
      <div className="w-full max-w-md pt-10">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-heading text-lg font-semibold"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BoxesIcon className="size-4" />
          </span>
          Gestão de Ativos
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Esqueci minha senha</CardTitle>
            <CardDescription>
              Informe seu e-mail e enviaremos um link para você definir uma nova senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
