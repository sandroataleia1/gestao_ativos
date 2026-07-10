import type { Metadata } from "next";
import Link from "next/link";
import { BoxesIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Definir senha — Gestão de Ativos",
};

// Página pública (sem sessão) — o token é validado pelo próprio endpoint
// oficial do Better Auth no POST (ver reset-password-form.tsx), não por uma
// consulta nossa: o token vem da tabela `Verification` que o Better Auth já
// gerencia, gerado por `generatePasswordResetLink` (lib/auth.ts) a partir de
// uma ação administrativa em /configuracoes/usuarios (convite ou
// redefinição de senha).
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

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
            <CardTitle className="text-lg">Defina sua senha</CardTitle>
            <CardDescription>Escolha uma senha para acessar sua conta.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm token={token} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
