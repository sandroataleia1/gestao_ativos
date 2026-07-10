"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2Icon, MailIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const GENERIC_MESSAGE =
  "Se esse e-mail estiver cadastrado, você vai receber um link para definir uma nova senha em instantes.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      // Endpoint nativo do Better Auth — sempre responde com a mesma
      // mensagem genérica independente de o e-mail existir ou não (ver
      // node_modules/better-auth/dist/api/routes/password.mjs), então a UI
      // aqui também mostra a mesma mensagem sem checar o resultado.
      await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Mesmo se a requisição falhar de rede, não revela nada de
      // diferente — mostra a mesma mensagem genérica.
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="grid gap-4">
        <Alert>
          <MailIcon />
          <AlertDescription>{GENERIC_MESSAGE}</AlertDescription>
        </Alert>
        <Link href="/login" className="text-sm text-muted-foreground underline underline-offset-4">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="forgot-password-email">E-mail</Label>
        <div className="relative">
          <MailIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="forgot-password-email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="voce@empresa.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            required
            className="pl-8"
          />
        </div>
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
        Enviar link de redefinição
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground underline underline-offset-4">
        Voltar para o login
      </Link>
    </form>
  );
}
