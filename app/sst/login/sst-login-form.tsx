"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon, LockIcon, Loader2Icon, MailIcon } from "lucide-react";

import { signIn } from "@/lib/auth-client";
import { focusFirstFieldWithError } from "@/lib/form-focus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MIN_PASSWORD_LENGTH = 8;

type FieldErrors = { email?: string; password?: string };

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) {
    errors.email = "Informe seu email.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Informe um email válido.";
  }
  if (!password) {
    errors.password = "Informe sua senha.";
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return errors;
}

export function SstLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validate(email, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstFieldWithError(errors, ["email", "password"]);
      return;
    }

    setIsSubmitting(true);
    const { error } = await signIn.email({ email, password });
    if (error) {
      setIsSubmitting(false);
      setFormError("Email ou senha inválidos.");
      return;
    }

    // A sessão foi criada (Better Auth, mesma sessão de todo o app), mas
    // isso não significa acesso ao Portal Consultoria — só
    // SstProviderUser.active confirma isso. Não desloga em caso de 403: a
    // sessão pode continuar válida para o Portal Empresa, se a pessoa
    // também tiver acesso lá.
    const meResponse = await fetch("/api/sst/me");
    setIsSubmitting(false);

    if (!meResponse.ok) {
      setFormError("Este usuário não possui acesso ao Portal Consultoria.");
      return;
    }

    router.push("/sst/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate method="post" className="grid gap-4">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <MailIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="voce@consultoria.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.email ? <p className="text-sm text-destructive">{fieldErrors.email}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Senha</Label>
        <div className="relative">
          <LockIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            disabled={isSubmitting}
            className="pl-8"
          />
        </div>
        {fieldErrors.password ? <p className="text-sm text-destructive">{fieldErrors.password}</p> : null}
      </div>

      <Button type="submit" disabled={isSubmitting} className="mt-2">
        {isSubmitting ? <Loader2Icon className="animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}
